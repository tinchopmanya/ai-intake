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

export function useSpeechToText(options?: UseSpeechToTextOptions) {
  const [supported] = useState(() => {
    const ctor = (
      typeof window !== "undefined"
        ? ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
          (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition)
        : undefined
    ) as SpeechRecognitionCtor | undefined;
    return Boolean(ctor);
  });
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const lang = options?.lang ?? "es-ES";
  const continuous = options?.continuous ?? false;
  const interimResults = options?.interimResults ?? false;

  const ensureRecognition = useCallback(() => {
    const ctor = (
      typeof window !== "undefined"
        ? ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
          (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition)
        : undefined
    ) as SpeechRecognitionCtor | undefined;
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
      setError(event.error ? `voice_${event.error}` : "voice_unknown_error");
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
    if (!recognition) return;
    setError(null);
    try {
      recognition.start();
    } catch {
      // Some browsers throw when calling start twice. Ignore to keep UX calm.
    }
  }, [ensureRecognition]);

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
