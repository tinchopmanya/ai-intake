"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSpeechToTextErrorMessage, useSpeechToText } from "@/hooks/useSpeechToText";

export type VoiceRecorderStatus =
  | "idle"
  | "countdown"
  | "recording"
  | "stopped"
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
  const statusRef = useRef<VoiceRecorderStatus>("idle");

  const speech = useSpeechToText({
    lang: options?.lang ?? "es-UY",
    continuous: false,
    interimResults: true,
    silenceTimeoutMs: 0,
    noSpeechIsRecoverable: true,
    emitNoSpeechOnEnd: false,
  });
  const speechListeningRef = useRef(speech.listening);
  const speechStartRef = useRef(speech.startListening);
  const speechStopRef = useRef(speech.stopListening);
  const speechResetRef = useRef(speech.resetTranscript);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    speechListeningRef.current = speech.listening;
    speechStartRef.current = speech.startListening;
    speechStopRef.current = speech.stopListening;
    speechResetRef.current = speech.resetTranscript;
  }, [speech.listening, speech.resetTranscript, speech.startListening, speech.stopListening]);

  const transcript = speech.transcript.trim();

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
    if (speechListeningRef.current) {
      speechStopRef.current();
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (speechListeningRef.current) {
      speechStopRef.current();
    }
    if (statusRef.current !== "sending") {
      setStatus("stopped");
    }
  }, []);

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
        setAudioBlob(blob.size > 0 ? blob : null);
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      };
      recorder.start();
      setStatus("recording");
      speechResetRef.current();
      speechStartRef.current();
    } catch {
      setStatus("error");
      setInternalErrorMessage("No pudimos acceder al microfono. Revisa los permisos del navegador.");
    }
  }, []);

  const startCountdown = useCallback(() => {
    clearCountdownTimer();
    setInternalErrorMessage(null);
    setAudioBlob(null);
    speechResetRef.current();
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
  }, [clearCountdownTimer, countdownSeconds, startRecording]);

  const resetRecording = useCallback(() => {
    clearCountdownTimer();
    cleanupMedia();
    speechResetRef.current();
    setAudioBlob(null);
    setInternalErrorMessage(null);
    setCountdown(countdownSeconds);
    setStatus("idle");
  }, [cleanupMedia, clearCountdownTimer, countdownSeconds]);

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
    return () => {
      clearCountdownTimer();
      cleanupMedia();
    };
  }, [cleanupMedia, clearCountdownTimer]);

  const canSend = useMemo(
    () => Boolean(audioBlob && status !== "countdown" && status !== "sending"),
    [audioBlob, status],
  );

  const errorMessage = useMemo(() => {
    if (internalErrorMessage) return internalErrorMessage;
    return getSpeechToTextErrorMessage(speech.error) ?? null;
  }, [internalErrorMessage, speech.error]);

  return {
    status,
    countdown,
    transcript,
    audioBlob,
    canSend,
    errorMessage,
    speechSupported: speech.speechSupported,
    microphoneStatus: speech.microphoneStatus,
    micSupported,
    startFlow,
    startRecording,
    stopRecording,
    resetRecording,
    setStatus,
    requestMicProbe,
  };
}
