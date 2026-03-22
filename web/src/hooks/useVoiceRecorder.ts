"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSpeechToTextErrorMessage, useSpeechToText } from "@/hooks/useSpeechToText";

export type VoiceRecorderStatus =
  | "idle"
  | "countdown"
  | "recording"
  | "recording_no_transcript"
  | "stopping"
  | "sending"
  | "error";

type UseVoiceRecorderOptions = {
  lang?: string;
  countdownSeconds?: number;
};

type MediaRecorderCtor = new (stream: MediaStream) => MediaRecorder;

function getMediaRecorderCtor(): MediaRecorderCtor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as typeof window & { MediaRecorder?: MediaRecorderCtor }).MediaRecorder;
  return candidate ?? null;
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const countdownSeconds = options?.countdownSeconds ?? 3;
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
  const statusRef = useRef<VoiceRecorderStatus>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const cleanupMedia = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    mediaStreamRef.current = null;
    if (speechListening) {
      stopListening();
    }
  }, [speechListening, stopListening]);

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
    const MediaRecorderClass = getMediaRecorderCtor();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !MediaRecorderClass) {
      setStatus("error");
      setInternalErrorMessage("La grabacion de audio no esta disponible en este navegador.");
      return;
    }

    setInternalErrorMessage(null);
    setAudioBlob(null);
    chunksRef.current = [];
    manualStopRef.current = false;
    recognitionRestartAttemptsRef.current = 0;
    finalizePromiseRef.current = null;
    finalizeResolverRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorderClass(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const resolvedBlob = blob.size > 0 ? blob : null;
        setAudioBlob(resolvedBlob);
        if (
          !manualStopRef.current &&
          (statusRef.current === "recording" || statusRef.current === "recording_no_transcript")
        ) {
          setStatus("error");
          setInternalErrorMessage("La grabacion se detuvo inesperadamente. Intenta nuevamente.");
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        resolveFinalize(resolvedBlob);
      };
      recorder.start(250);
      setStatus("recording");
      resetTranscript();
      startListening();
    } catch {
      setStatus("error");
      setInternalErrorMessage("No pudimos acceder al microfono. Revisa los permisos del navegador.");
    }
  }, [resolveFinalize, resetTranscript, startListening]);

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
        void startRecording();
        return;
      }
      setCountdown(remaining);
    }, 1000);
  }, [clearCountdownTimer, countdownSeconds, resetTranscript, startRecording]);

  const stopRecording = useCallback((): Promise<{ audioBlob: Blob | null; transcript: string }> => {
    clearCountdownTimer();
    manualStopRef.current = true;

    if (statusRef.current === "countdown") {
      const payload = buildFinalPayload(null);
      setStatus("idle");
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
  }, [audioBlob, buildFinalPayload, clearCountdownTimer, resolveFinalize, speechListening, stopListening]);

  const finalizeRecording = useCallback(async () => {
    const payload = await stopRecording();
    if (statusRef.current !== "sending") {
      setStatus("idle");
    }
    return payload;
  }, [stopRecording]);

  const resetRecording = useCallback(() => {
    clearCountdownTimer();
    manualStopRef.current = true;
    cleanupMedia();
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
        startListening();
        return;
      }
      if (statusRef.current === "recording") {
        setStatus("recording_no_transcript");
      }
    }, 220);
    return () => window.clearTimeout(noTranscriptTimer);
  }, [speechListening, speechSupported, startListening, status]);

  useEffect(() => {
    if (status === "countdown" || status === "recording" || status === "recording_no_transcript" || status === "stopping") {
      return;
    }
    manualStopRef.current = false;
    recognitionRestartAttemptsRef.current = 0;
  }, [status]);

  useEffect(() => {
    return () => {
      clearCountdownTimer();
      cleanupMedia();
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
