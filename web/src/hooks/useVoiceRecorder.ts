"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSpeechToTextErrorMessage, useSpeechToText } from "@/hooks/useSpeechToText";

export type VoiceRecorderStatus =
  | "idle"
  | "countdown"
  | "initializing_media"
  | "recording"
  | "recording_no_transcript"
  | "stopping"
  | "sending"
  | "error";

type UseVoiceRecorderOptions = {
  lang?: string;
  countdownSeconds?: number;
};

type MediaRecorderCtor = new (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder;

function getMediaRecorderCtor(): MediaRecorderCtor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as typeof window & { MediaRecorder?: MediaRecorderCtor }).MediaRecorder;
  return candidate ?? null;
}

function mapMediaInitError(error: unknown): string {
  const maybeError = error as { name?: string };
  if (maybeError?.name === "NotAllowedError" || maybeError?.name === "PermissionDeniedError") {
    return "No pudimos acceder al microfono. Revisa los permisos del navegador.";
  }
  if (
    maybeError?.name === "NotFoundError" ||
    maybeError?.name === "DevicesNotFoundError" ||
    maybeError?.name === "TrackStartError" ||
    maybeError?.name === "NotReadableError"
  ) {
    return "No detectamos un microfono disponible.";
  }
  return "No se pudo iniciar la grabacion de audio. Intenta nuevamente.";
}

function pickSupportedMimeType(MediaRecorderClass: MediaRecorderCtor): string | null {
  const probe = MediaRecorderClass as typeof MediaRecorder & { isTypeSupported?: (mime: string) => boolean };
  if (typeof probe.isTypeSupported !== "function") return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of candidates) {
    if (probe.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const countdownSeconds = options?.countdownSeconds ?? 3;
  const isDevelopment = process.env.NODE_ENV !== "production";
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [countdown, setCountdown] = useState<number>(countdownSeconds);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [internalErrorMessage, setInternalErrorMessage] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState<boolean>(() => Boolean(getMediaRecorderCtor()));
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const manualStopRef = useRef(false);
  const startAttemptRef = useRef(0);
  const recorderStartedRef = useRef(false);
  const recognitionRestartAttemptsRef = useRef(0);
  const finalizePromiseRef = useRef<Promise<{ audioBlob: Blob | null; transcript: string }> | null>(null);
  const finalizeResolverRef = useRef<((value: { audioBlob: Blob | null; transcript: string }) => void) | null>(
    null,
  );

  const speech = useSpeechToText({
    lang: options?.lang ?? "es-UY",
    continuous: false,
    interimResults: true,
    silenceTimeoutMs: 0,
    noSpeechIsRecoverable: true,
    emitNoSpeechOnEnd: false,
  });

  const transcript = speech.transcript.trim();
  const speechListening = speech.listening;
  const speechSupported = speech.speechSupported;
  const startListening = speech.startListening;
  const stopListening = speech.stopListening;
  const resetTranscript = speech.resetTranscript;
  const speechListeningRef = useRef(speechListening);
  const stopListeningRef = useRef(stopListening);
  useEffect(() => {
    speechListeningRef.current = speechListening;
  }, [speechListening]);
  useEffect(() => {
    stopListeningRef.current = stopListening;
  }, [stopListening]);
  const statusRef = useRef<VoiceRecorderStatus>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const pushDebug = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!isDevelopment) return;
      if (details) {
        console.debug("[voice][recorder]", event, details);
      } else {
        console.debug("[voice][recorder]", event);
      }
    },
    [isDevelopment],
  );

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const cleanupMedia = useCallback((reason = "cleanup") => {
    pushDebug("cleanup media", { reason, recorderState: mediaRecorderRef.current?.state ?? "none" });
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    mediaStreamRef.current = null;
    if (speechListeningRef.current) {
      stopListeningRef.current();
    }
  }, [pushDebug]);

  const buildFinalPayload = useCallback(
    (blob: Blob | null) => ({
      audioBlob: blob,
      transcript: speech.transcript.trim(),
    }),
    [speech.transcript],
  );

  const resolveFinalize = useCallback(
    (blob: Blob | null) => {
      if (finalizeResolverRef.current) {
        finalizeResolverRef.current(buildFinalPayload(blob));
        finalizeResolverRef.current = null;
        finalizePromiseRef.current = null;
      }
    },
    [buildFinalPayload],
  );

  const startRecording = useCallback(async () => {
    if (
      statusRef.current === "initializing_media" ||
      statusRef.current === "recording" ||
      statusRef.current === "recording_no_transcript" ||
      statusRef.current === "stopping" ||
      statusRef.current === "sending"
    ) {
      pushDebug("startRecording ignored", { status: statusRef.current });
      return;
    }
    const MediaRecorderClass = getMediaRecorderCtor();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !MediaRecorderClass) {
      setStatus("error");
      setInternalErrorMessage("La grabacion de audio no esta disponible en este navegador.");
      pushDebug("startRecording blocked", { reason: "media recorder unsupported" });
      return;
    }

    startAttemptRef.current += 1;
    const attemptId = startAttemptRef.current;
    pushDebug("startRecording begin", { attemptId });
    setStatus("initializing_media");
    setInternalErrorMessage(null);
    setAudioBlob(null);
    chunksRef.current = [];
    manualStopRef.current = false;
    recorderStartedRef.current = false;
    recognitionRestartAttemptsRef.current = 0;
    finalizePromiseRef.current = null;
    finalizeResolverRef.current = null;

    try {
      pushDebug("getUserMedia requested", { attemptId });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attemptId !== startAttemptRef.current || manualStopRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        pushDebug("stale media stream discarded", { attemptId, currentAttempt: startAttemptRef.current });
        return;
      }
      mediaStreamRef.current = stream;
      pushDebug("media stream acquired", {
        attemptId,
        tracks: stream.getAudioTracks().map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
          enabled: track.enabled,
          muted: track.muted,
          label: track.label,
        })),
      });
      const selectedMimeType = pickSupportedMimeType(MediaRecorderClass);
      pushDebug("mime type selected", { selectedMimeType: selectedMimeType ?? "default" });
      let recorder: MediaRecorder;
      try {
        recorder = selectedMimeType
          ? new MediaRecorderClass(stream, { mimeType: selectedMimeType })
          : new MediaRecorderClass(stream);
      } catch {
        recorder = new MediaRecorderClass(stream);
        pushDebug("media recorder created without explicit mime fallback");
      }
      mediaRecorderRef.current = recorder;
      pushDebug("media recorder created", { state: recorder.state, mimeType: recorder.mimeType || null });
      recorder.ondataavailable = (event) => {
        pushDebug("media recorder ondataavailable", { size: event.data?.size ?? 0 });
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        setStatus("error");
        setInternalErrorMessage("No se pudo iniciar la grabacion de audio. Intenta nuevamente.");
        pushDebug("media recorder onerror", { error: String((event as Event).type) });
      };
      recorder.onstart = () => {
        if (attemptId !== startAttemptRef.current) {
          pushDebug("media recorder onstart ignored stale attempt", { attemptId, currentAttempt: startAttemptRef.current });
          return;
        }
        recorderStartedRef.current = true;
        setStatus("recording");
        pushDebug("media recorder started");
        startListening();
        pushDebug("speech recognition start requested");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const resolvedBlob = blob.size > 0 ? blob : null;
        setAudioBlob(resolvedBlob);
        pushDebug("media recorder stopped", { blobSize: resolvedBlob?.size ?? 0, manualStop: manualStopRef.current });
        if (!manualStopRef.current && !recorderStartedRef.current) {
          setStatus("error");
          setInternalErrorMessage("No se pudo iniciar la grabacion de audio. Intenta nuevamente.");
        } else if (
          !manualStopRef.current &&
          recorderStartedRef.current &&
          (statusRef.current === "recording" || statusRef.current === "recording_no_transcript")
        ) {
          setStatus("error");
          setInternalErrorMessage("La grabacion se detuvo inesperadamente. Intenta nuevamente.");
        }
        if (
          mediaStreamRef.current
        ) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        resolveFinalize(resolvedBlob);
      };
      pushDebug("media recorder start() invoked", { attemptId, timesliceMs: 250 });
      recorder.start(250);
      resetTranscript();
    } catch (error) {
      setStatus("error");
      setInternalErrorMessage(mapMediaInitError(error));
      pushDebug("startRecording failed", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [pushDebug, resolveFinalize, resetTranscript, startListening]);

  const startCountdown = useCallback(() => {
    clearCountdownTimer();
    setInternalErrorMessage(null);
    setAudioBlob(null);
    resetTranscript();
    setStatus("countdown");
    setCountdown(countdownSeconds);
    let remaining = countdownSeconds;
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdownTimer();
        setCountdown(0);
        pushDebug("countdown completed");
        void startRecording();
        return;
      }
      setCountdown(remaining);
    }, 1000);
  }, [clearCountdownTimer, countdownSeconds, pushDebug, resetTranscript, startRecording]);

  const stopRecording = useCallback((): Promise<{ audioBlob: Blob | null; transcript: string }> => {
    clearCountdownTimer();
    manualStopRef.current = true;
    pushDebug("stopRecording called", { status: statusRef.current });

    if (statusRef.current === "countdown") {
      const payload = buildFinalPayload(null);
      setStatus("idle");
      pushDebug("stopRecording during countdown");
      return Promise.resolve(payload);
    }

    if (statusRef.current === "initializing_media") {
      const payload = buildFinalPayload(null);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      mediaRecorderRef.current = null;
      setStatus("idle");
      pushDebug("stopRecording during media init");
      return Promise.resolve(payload);
    }

    if (finalizePromiseRef.current) {
      return finalizePromiseRef.current;
    }

    const finalizePromise = new Promise<{ audioBlob: Blob | null; transcript: string }>((resolve) => {
      finalizeResolverRef.current = resolve;
    });
    finalizePromiseRef.current = finalizePromise;
    setStatus("stopping");

    if (speechListening) {
      stopListening();
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (typeof mediaRecorderRef.current.requestData === "function") {
        try {
          mediaRecorderRef.current.requestData();
        } catch {
          // Some browsers throw if requestData is called while stopping.
        }
      }
      mediaRecorderRef.current.stop();
    } else {
      resolveFinalize(audioBlob);
    }
    return finalizePromise;
  }, [audioBlob, buildFinalPayload, clearCountdownTimer, pushDebug, resolveFinalize, speechListening, stopListening]);

  const finalizeRecording = useCallback(async () => {
    pushDebug("finalizeRecording called", { status: statusRef.current });
    const payload = await stopRecording();
    if (statusRef.current !== "sending") {
      setStatus("idle");
    }
    pushDebug("finalizeRecording resolved", { hasAudio: Boolean(payload.audioBlob), transcriptLength: payload.transcript.length });
    return payload;
  }, [pushDebug, stopRecording]);

  const resetRecording = useCallback(() => {
    clearCountdownTimer();
    manualStopRef.current = true;
    startAttemptRef.current += 1;
    recorderStartedRef.current = false;
    cleanupMedia("resetRecording");
    resetTranscript();
    setAudioBlob(null);
    setInternalErrorMessage(null);
    setCountdown(countdownSeconds);
    setStatus("idle");
    finalizeResolverRef.current = null;
    finalizePromiseRef.current = null;
  }, [cleanupMedia, clearCountdownTimer, countdownSeconds, resetTranscript]);

  const startFlow = useCallback(() => {
    resetRecording();
    startCountdown();
  }, [resetRecording, startCountdown]);

  const requestMicProbe = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicSupported(false);
      setStatus("error");
      setInternalErrorMessage("La grabacion de audio no esta disponible en este navegador.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicSupported(true);
      setInternalErrorMessage(null);
      return true;
    } catch {
      setMicSupported(false);
      setStatus("error");
      setInternalErrorMessage("No pudimos acceder al microfono. Revisa los permisos del navegador.");
      return false;
    }
  }, []);

  useEffect(() => {
    if (status !== "recording" && status !== "recording_no_transcript") return;
    if (speechListening) {
      if (status === "recording_no_transcript") {
        const syncTimer = window.setTimeout(() => {
          setStatus("recording");
        }, 0);
        return () => window.clearTimeout(syncTimer);
      }
      return;
    }

    const noTranscriptTimer = window.setTimeout(() => {
      if (speechSupported && !manualStopRef.current && recognitionRestartAttemptsRef.current < 2) {
        recognitionRestartAttemptsRef.current += 1;
        pushDebug("speech recognition ended, attempting restart", { attempt: recognitionRestartAttemptsRef.current });
        startListening();
        return;
      }
      if (statusRef.current === "recording") {
        setStatus("recording_no_transcript");
      }
    }, 220);
    return () => window.clearTimeout(noTranscriptTimer);
  }, [pushDebug, speechListening, speechSupported, startListening, status]);

  useEffect(() => {
    if (status === "countdown" || status === "recording" || status === "recording_no_transcript" || status === "stopping") {
      return;
    }
    manualStopRef.current = false;
    recognitionRestartAttemptsRef.current = 0;
    recorderStartedRef.current = false;
  }, [status]);

  useEffect(() => {
    return () => {
      clearCountdownTimer();
      cleanupMedia("unmount");
    };
  }, [cleanupMedia, clearCountdownTimer]);

  const errorMessage = useMemo(() => {
    if (internalErrorMessage) return internalErrorMessage;
    return getSpeechToTextErrorMessage(speech.error) ?? null;
  }, [internalErrorMessage, speech.error]);

  return {
    status,
    countdown,
    transcript,
    audioBlob,
    errorMessage,
    speechSupported,
    microphoneStatus: speech.microphoneStatus,
    micSupported,
    transcribing: (status === "recording" || status === "recording_no_transcript") && speechListening,
    speechListening,
    startFlow,
    startRecording,
    stopRecording,
    finalizeRecording,
    resetRecording,
    setStatus,
    requestMicProbe,
  };
}
