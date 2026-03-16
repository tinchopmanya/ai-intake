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
};

type SpeechToTextErrorCode =
  | "voice_not_supported"
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
    case "voice_not_supported":
      return "La entrada por voz no esta disponible en este navegador.";
    case "voice_not_allowed":
      return "No se pudo acceder al microfono. Revisa los permisos del navegador.";
    case "voice_no_microphone":
      return "No detectamos un microfono disponible.";
    case "voice_network":
      return "El reconocimiento de voz fallo por red. Intenta de nuevo.";
    case "voice_no_speech":
      return "No detectamos voz. Intenta hablar mas cerca del microfono.";
    case "voice_start_failed":
      return "No se pudo iniciar la entrada por voz. Intenta de nuevo.";
    default:
      return "No pudimos transcribir el audio. Intenta de nuevo.";
  }
}

export function useSpeechToText(options?: UseSpeechToTextOptions) {
  const supported = Boolean(getSpeechRecognitionCtor());
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const lang = options?.lang ?? "es-ES";
  const continuous = options?.continuous ?? false;
  const interimResults = options?.interimResults ?? false;

  const ensureRecognition = useCallback(() => {
    const ctor = getSpeechRecognitionCtor();
    if (!ctor) return null;
    if (recognitionRef.current) return recognitionRef.current;

    const recognition = new ctor();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(mapSpeechErrorCode(event.error));
    };
    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]?.transcript) {
          finalText += result[0].transcript;
        }
      }
      if (finalText.trim()) {
        setTranscript((previous) => `${previous} ${finalText}`.trim());
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [continuous, interimResults, lang]);

  const startListening = useCallback(() => {
    const recognition = ensureRecognition();
    if (!recognition) {
      setError("voice_not_supported");
      return;
    }
    if (listening) return;
    setError(null);
    try {
      recognition.start();
    } catch (exc) {
      const message = exc instanceof Error ? exc.message.toLowerCase() : "";
      if (message.includes("already started")) {
        return;
      }
      if (message.includes("notallowed") || message.includes("permission")) {
        setError("voice_not_allowed");
        return;
      }
      if (message.includes("audio-capture")) {
        setError("voice_no_microphone");
        return;
      }
      setError("voice_start_failed");
    }
  }, [ensureRecognition, listening]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.stop();
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}
