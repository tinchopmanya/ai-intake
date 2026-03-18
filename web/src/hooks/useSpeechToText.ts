"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionResultAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionResultAlternativeLike;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: {
    [index: number]: SpeechRecognitionResultLike;
    length: number;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type UseSpeechToTextOptions = {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  silenceTimeoutMs?: number;
  noSpeechIsRecoverable?: boolean;
  emitNoSpeechOnEnd?: boolean;
};

export type MicrophonePermissionStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unsupported";

export type SpeechToTextPhase =
  | "idle"
  | "listening"
  | "finishing"
  | "transcript_ready"
  | "error";

export type SpeechToTextDebugEvent = {
  at: string;
  event: string;
  details?: Record<string, unknown>;
};

type SpeechToTextErrorCode =
  | "voice_not_supported"
  | "voice_speech_not_supported"
  | "voice_not_allowed"
  | "voice_no_microphone"
  | "voice_network"
  | "voice_no_speech"
  | "voice_aborted"
  | "voice_start_failed"
  | "voice_unknown_error";

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function mapSpeechErrorCode(rawError?: string): SpeechToTextErrorCode {
  switch (rawError) {
    case "not-allowed":
    case "service-not-allowed":
      return "voice_not_allowed";
    case "audio-capture":
      return "voice_no_microphone";
    case "network":
      return "voice_network";
    case "no-speech":
      return "voice_no_speech";
    case "aborted":
      return "voice_aborted";
    default:
      return rawError ? "voice_unknown_error" : "voice_unknown_error";
  }
}

export function getSpeechToTextErrorMessage(error: string | null): string | null {
  if (!error) return null;
  switch (error) {
    case "voice_speech_not_supported":
      return "El microfono esta disponible, pero el dictado por voz no es compatible en este navegador.";
    case "voice_not_supported":
      return "La entrada por voz no esta disponible en este navegador.";
    case "voice_not_allowed":
      return "No se pudo acceder al microfono. Revisa los permisos del navegador.";
    case "voice_no_microphone":
      return "No detectamos un microfono disponible.";
    case "voice_network":
      return "El reconocimiento de voz fallo por red. Intenta de nuevo.";
    case "voice_no_speech":
      return "No detecte tu voz. Intenta de nuevo y habla apenas empiece a escuchar.";
    case "voice_start_failed":
      return "No se pudo iniciar la entrada por voz. Intenta de nuevo.";
    default:
      return "No pudimos transcribir el audio. Intenta de nuevo.";
  }
}

export function getMicrophoneStatusMessage(
  status: MicrophonePermissionStatus,
  speechSupported: boolean,
): string | null {
  switch (status) {
    case "requesting":
      return "Solicitando acceso al microfono...";
    case "granted":
      return speechSupported
        ? "Puedes usar dictado por voz en este navegador."
        : "El microfono esta disponible, pero el dictado por voz no es compatible en este navegador.";
    case "denied":
      return "No se pudo acceder al microfono. Revisa los permisos del navegador.";
    case "unsupported":
      return "Este navegador no permite acceso al microfono desde la app.";
    case "idle":
    default:
      return null;
  }
}

function hasMicrophonePermissionApi(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

function mapGetUserMediaError(error: unknown): SpeechToTextErrorCode {
  const maybeError = error as { name?: string };
  switch (maybeError?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "voice_not_allowed";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "TrackStartError":
    case "NotReadableError":
      return "voice_no_microphone";
    default:
      return "voice_unknown_error";
  }
}

export function useSpeechToText(options?: UseSpeechToTextOptions) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const speechSupported = Boolean(getSpeechRecognitionCtor());
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophonePermissionStatus>("idle");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptSource, setTranscriptSource] = useState<"none" | "interim" | "final">("none");
  const [resultCount, setResultCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SpeechToTextPhase>("idle");
  const [debugEvents, setDebugEvents] = useState<SpeechToTextDebugEvent[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const hadRecognitionErrorRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const startWatchdogTimerRef = useRef<number | null>(null);
  const startPendingRef = useRef(false);
  const onStartSeenRef = useRef(false);
  const sessionStartedAtRef = useRef<number | null>(null);
  const hadResultInCurrentSessionRef = useRef(false);
  const [lastSessionDurationMs, setLastSessionDurationMs] = useState<number | null>(null);
  const [lastSessionHadResult, setLastSessionHadResult] = useState(false);
  const [lastSessionHadTranscript, setLastSessionHadTranscript] = useState(false);

  const lang = options?.lang ?? "es-ES";
  const continuous = options?.continuous ?? false;
  const interimResults = options?.interimResults ?? false;
  const silenceTimeoutMs = options?.silenceTimeoutMs ?? 0;
  const noSpeechIsRecoverable = options?.noSpeechIsRecoverable ?? false;
  const emitNoSpeechOnEnd = options?.emitNoSpeechOnEnd ?? false;

  const pushDebugEvent = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!isDevelopment) return;
      const entry: SpeechToTextDebugEvent = {
        at: new Date().toISOString(),
        event,
        details,
      };
      setDebugEvents((current) => [...current.slice(-79), entry]);
      if (details) {
        console.debug("[voice][stt]", event, details);
      } else {
        console.debug("[voice][stt]", event);
      }
    },
    [isDevelopment],
  );

  const clearStartWatchdogTimer = useCallback(() => {
    if (startWatchdogTimerRef.current !== null) {
      window.clearTimeout(startWatchdogTimerRef.current);
      startWatchdogTimerRef.current = null;
    }
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const scheduleSilenceStop = useCallback(() => {
    if (silenceTimeoutMs <= 0) return;
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      const recognition = recognitionRef.current;
      if (!recognition) return;
      setPhase("finishing");
      recognition.stop();
    }, silenceTimeoutMs);
  }, [clearSilenceTimer, silenceTimeoutMs]);

  const requestMicrophonePermission = useCallback(async () => {
    pushDebugEvent("requestMicrophonePermission called", { microphoneStatus });
    if (typeof navigator === "undefined") {
      setMicrophoneStatus("unsupported");
      setError("voice_no_microphone");
      pushDebugEvent("requestMicrophonePermission unsupported navigator");
      return false;
    }
    if (!hasMicrophonePermissionApi()) {
      setMicrophoneStatus("unsupported");
      setError("voice_no_microphone");
      pushDebugEvent("requestMicrophonePermission unsupported mediaDevices");
      return false;
    }

    setMicrophoneStatus("requesting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophoneStatus("granted");
      pushDebugEvent("requestMicrophonePermission granted");
      return true;
    } catch (exc) {
      setMicrophoneStatus("denied");
      const mappedError = mapGetUserMediaError(exc);
      setError(mappedError);
      pushDebugEvent("requestMicrophonePermission rejected", { mappedError });
      return false;
    }
  }, [microphoneStatus, pushDebugEvent]);

  const ensureRecognition = useCallback(() => {
    const ctor = getSpeechRecognitionCtor();
    if (!ctor) {
      pushDebugEvent("recognition ctor missing");
      return null;
    }
    if (recognitionRef.current) return recognitionRef.current;
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new ctor();
      pushDebugEvent("recognition instance created");
    } catch (exc) {
      setError("voice_start_failed");
      setPhase("error");
      pushDebugEvent("recognition instance creation failed", {
        message: exc instanceof Error ? exc.message : String(exc),
      });
      return null;
    }
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    pushDebugEvent("recognition configured", {
      lang,
      continuous,
      interimResults,
      silenceTimeoutMs,
      noSpeechIsRecoverable,
      emitNoSpeechOnEnd,
      micActivityObservable: false,
    });

    recognition.onstart = () => {
      onStartSeenRef.current = true;
      startPendingRef.current = false;
      clearStartWatchdogTimer();
      sessionStartedAtRef.current = Date.now();
      hadResultInCurrentSessionRef.current = false;
      pushDebugEvent("recognition.onstart fired", {
        lang,
        continuous,
        interimResults,
        micActivityObservable: false,
      });
      setListening(true);
      setError(null);
      setPhase("listening");
      setResultCount(0);
      setTranscriptSource("none");
      hadRecognitionErrorRef.current = false;
      scheduleSilenceStop();
    };
    recognition.onend = () => {
      clearStartWatchdogTimer();
      const sessionDurationMs = sessionStartedAtRef.current
        ? Date.now() - sessionStartedAtRef.current
        : null;
      const hadResultInSession = hadResultInCurrentSessionRef.current;
      setLastSessionDurationMs(sessionDurationMs);
      setLastSessionHadResult(hadResultInSession);
      pushDebugEvent("recognition.onend fired", {
        hadRecognitionError: hadRecognitionErrorRef.current,
        onStartSeen: onStartSeenRef.current,
        sessionDurationMs,
        hadResultInSession,
      });
      setListening(false);
      clearSilenceTimer();
      if (!onStartSeenRef.current && !hadRecognitionErrorRef.current && startPendingRef.current) {
        setError("voice_start_failed");
        setPhase("error");
        hadRecognitionErrorRef.current = true;
        startPendingRef.current = false;
        pushDebugEvent("recognition.onend before onstart, marking start failure");
        return;
      }
      if (!hadRecognitionErrorRef.current) {
        const resolved = finalTranscriptRef.current.trim() || transcriptRef.current.trim();
        const hasTranscript = Boolean(resolved);
        setLastSessionHadTranscript(hasTranscript);
        if (resolved && resolved !== transcriptRef.current.trim()) {
          setTranscript(resolved);
        }
        setTranscriptSource(resolved ? (finalTranscriptRef.current.trim() ? "final" : "interim") : "none");
        if (!hasTranscript && emitNoSpeechOnEnd) {
          setError("voice_no_speech");
        }
        setPhase(resolved ? "transcript_ready" : "idle");
      }
      sessionStartedAtRef.current = null;
    };
    recognition.onerror = (event) => {
      clearStartWatchdogTimer();
      pushDebugEvent("recognition.onerror fired", { error: event.error });
      setListening(false);
      const mappedError = mapSpeechErrorCode(event.error);
      const noSpeechRecoverable = mappedError === "voice_no_speech" && noSpeechIsRecoverable;
      setError(mappedError);
      clearSilenceTimer();
      setPhase(noSpeechRecoverable ? "idle" : "error");
      hadRecognitionErrorRef.current = !noSpeechRecoverable;
      startPendingRef.current = false;
    };
    recognition.onresult = (event) => {
      hadResultInCurrentSessionRef.current = true;
      pushDebugEvent("recognition.onresult fired", {
        resultIndex: event.resultIndex,
        totalResults: event.results.length,
      });
      let finalText = "";
      let interimText = "";
      setResultCount((current) => current + 1);
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.[0]?.transcript) {
          scheduleSilenceStop();
        }
        if (result?.isFinal && result[0]?.transcript) {
          finalText += result[0].transcript;
        } else if (result?.[0]?.transcript) {
          interimText += result[0].transcript;
        }
      }
      if (finalText.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalText}`.trim();
      }
      interimTranscriptRef.current = interimText.trim();
      const merged = `${finalTranscriptRef.current} ${interimTranscriptRef.current}`.trim();
      if (!merged) return;
      setTranscript(merged);
      setTranscriptSource(interimTranscriptRef.current ? "interim" : "final");
      setLastSessionHadTranscript(true);
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [
    clearSilenceTimer,
    clearStartWatchdogTimer,
    continuous,
    emitNoSpeechOnEnd,
    interimResults,
    lang,
    noSpeechIsRecoverable,
    pushDebugEvent,
    scheduleSilenceStop,
    silenceTimeoutMs,
  ]);

  const startListening = useCallback(() => {
    pushDebugEvent("startListening called", {
      microphoneStatus,
      speechSupported,
      listening,
    });
    if (!speechSupported) {
      setError("voice_speech_not_supported");
      setPhase("error");
      pushDebugEvent("startListening blocked: speech not supported");
      return;
    }

    const recognition = ensureRecognition();
    if (!recognition) {
      setError("voice_not_supported");
      setPhase("error");
      pushDebugEvent("startListening blocked: recognition unavailable");
      return;
    }
    if (listening) {
      pushDebugEvent("startListening ignored because already listening");
      return;
    }
    setError(null);
    setLastSessionDurationMs(null);
    setLastSessionHadResult(false);
    setLastSessionHadTranscript(false);
    setPhase("listening");
    hadRecognitionErrorRef.current = false;
    onStartSeenRef.current = false;
    startPendingRef.current = true;
    clearStartWatchdogTimer();
    startWatchdogTimerRef.current = window.setTimeout(() => {
      if (onStartSeenRef.current || hadRecognitionErrorRef.current) return;
      startPendingRef.current = false;
      setError("voice_start_failed");
      setPhase("error");
      pushDebugEvent("recognition start watchdog timeout");
    }, 1800);
    try {
      pushDebugEvent("recognition.start invoked");
      recognition.start();
      if (microphoneStatus !== "granted") {
        void requestMicrophonePermission();
      }
    } catch (exc) {
      clearStartWatchdogTimer();
      startPendingRef.current = false;
      const message = exc instanceof Error ? exc.message.toLowerCase() : "";
      pushDebugEvent("recognition.start threw", {
        message: exc instanceof Error ? exc.message : String(exc),
      });
      if (message.includes("already started")) {
        return;
      }
      if (message.includes("notallowed") || message.includes("permission")) {
        setError("voice_not_allowed");
        setPhase("error");
        return;
      }
      if (message.includes("audio-capture")) {
        setError("voice_no_microphone");
        setPhase("error");
        return;
      }
      setError("voice_start_failed");
      setPhase("error");
    }
  }, [
    clearStartWatchdogTimer,
    ensureRecognition,
    listening,
    microphoneStatus,
    pushDebugEvent,
    requestMicrophonePermission,
    speechSupported,
  ]);

  const stopListening = useCallback(() => {
    pushDebugEvent("stopListening called");
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setPhase("finishing");
    clearSilenceTimer();
    clearStartWatchdogTimer();
    startPendingRef.current = false;
    recognition.stop();
  }, [clearSilenceTimer, clearStartWatchdogTimer, pushDebugEvent]);

  const resetTranscript = useCallback(() => {
    pushDebugEvent("resetTranscript called");
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setTranscript("");
    setTranscriptSource("none");
    setResultCount(0);
    if (!listening) {
      setPhase("idle");
    }
  }, [listening, pushDebugEvent]);

  const clearDebugEvents = useCallback(() => {
    setDebugEvents([]);
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      clearStartWatchdogTimer();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [clearSilenceTimer, clearStartWatchdogTimer]);

  return {
    supported: speechSupported,
    speechSupported,
    microphoneStatus,
    phase,
    listening,
    transcript,
    transcriptSource,
    resultCount,
    error,
    requestMicrophonePermission,
    startListening,
    stopListening,
    resetTranscript,
    debugEvents,
    clearDebugEvents,
    config: {
      lang,
      continuous,
      interimResults,
      silenceTimeoutMs,
      noSpeechIsRecoverable,
      emitNoSpeechOnEnd,
    },
    lastSessionDurationMs,
    lastSessionHadResult,
    lastSessionHadTranscript,
  };
}
