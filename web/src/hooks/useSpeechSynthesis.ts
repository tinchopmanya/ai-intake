"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseSpeechSynthesisOptions = {
  lang?: string;
};

export function useSpeechSynthesis(options?: UseSpeechSynthesisOptions) {
  const [supported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );
  const [speaking, setSpeaking] = useState(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const lang = options?.lang ?? "es-ES";

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    activeUtteranceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        activeUtteranceRef.current = null;
      };
      utterance.onerror = () => {
        setSpeaking(false);
        activeUtteranceRef.current = null;
      };
      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [lang],
  );

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    supported,
    speaking,
    speak,
    stop,
  };
}
