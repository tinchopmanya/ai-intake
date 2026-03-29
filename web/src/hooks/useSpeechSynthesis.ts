"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { postTtsStream } from "@/lib/api/client";
import type { SupportedTtsVoice } from "@/lib/api/types";
import type { TtsVoicePreset } from "@/lib/api/types";

type UseSpeechSynthesisOptions = {
  lang?: string;
  voice?: SupportedTtsVoice;
  voicePreset?: TtsVoicePreset;
};

type SpeakOptions = {
  voice?: SupportedTtsVoice;
  voicePreset?: TtsVoicePreset;
};

const TTS_VOICE_PRESETS: Record<TtsVoicePreset, SupportedTtsVoice> = {
  female: "es-AR-ElenaNeural",
  male: "es-ES-AlvaroNeural",
};

function resolveVoice(options?: SpeakOptions & UseSpeechSynthesisOptions): SupportedTtsVoice {
  if (options?.voice) return options.voice;
  if (options?.voicePreset) return TTS_VOICE_PRESETS[options.voicePreset];
  return TTS_VOICE_PRESETS.female;
}

function canUseBrowserSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function canUseMediaSourceStreaming(): boolean {
  return (
    typeof window !== "undefined" &&
    "MediaSource" in window &&
    typeof window.MediaSource?.isTypeSupported === "function" &&
    window.MediaSource.isTypeSupported("audio/mpeg")
  );
}

export function useSpeechSynthesis(options?: UseSpeechSynthesisOptions) {
  const [supported] = useState(() => typeof window !== "undefined");
  const [speaking, setSpeaking] = useState(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const appendQueueRef = useRef<ArrayBuffer[]>([]);
  const streamEndedRef = useRef(false);
  const receivedAudioChunkRef = useRef(false);
  const lang = options?.lang ?? "es-ES";

  const cleanupStreamingAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    audioRef.current = null;
    if (objectUrlRef.current && typeof URL !== "undefined") {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = null;
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    appendQueueRef.current = [];
    streamEndedRef.current = false;
    receivedAudioChunkRef.current = false;
  }, []);

  const finishIfReady = useCallback(() => {
    const mediaSource = mediaSourceRef.current;
    const sourceBuffer = sourceBufferRef.current;
    if (
      mediaSource &&
      sourceBuffer &&
      streamEndedRef.current &&
      appendQueueRef.current.length === 0 &&
      !sourceBuffer.updating &&
      mediaSource.readyState === "open"
    ) {
      try {
        mediaSource.endOfStream();
      } catch {
        // ignore end-of-stream races
      }
    }
  }, []);

  const flushQueue = useCallback(() => {
    const sourceBuffer = sourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating) return;
    const nextChunk = appendQueueRef.current.shift();
    if (!nextChunk) {
      finishIfReady();
      return;
    }
    try {
      sourceBuffer.appendBuffer(nextChunk);
    } catch (error) {
      console.error("tts_stream_append_failed", error);
      finishIfReady();
    }
  }, [finishIfReady]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (canUseBrowserSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
    activeUtteranceRef.current = null;
    cleanupStreamingAudio();
    setSpeaking(false);
  }, [cleanupStreamingAudio]);

  const speakWithBrowserFallback = useCallback(
    (text: string) => {
      if (!text.trim() || !canUseBrowserSpeechSynthesis()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.95;
      utterance.pitch = 1.02;
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

  const speak = useCallback(
    async (text: string, speakOptions?: SpeakOptions) => {
      if (!text.trim()) return;
      stop();

      const selectedVoice = resolveVoice({
        voice: speakOptions?.voice ?? options?.voice,
        voicePreset: speakOptions?.voicePreset ?? options?.voicePreset,
      });

      if (!canUseMediaSourceStreaming()) {
        speakWithBrowserFallback(text);
        return;
      }

      const mediaSource = new MediaSource();
      const audio = new Audio();
      const objectUrl = URL.createObjectURL(mediaSource);
      objectUrlRef.current = objectUrl;
      mediaSourceRef.current = mediaSource;
      audioRef.current = audio;
      audio.src = objectUrl;
      audio.preload = "auto";
      audio.onended = () => {
        setSpeaking(false);
        cleanupStreamingAudio();
      };
      audio.onerror = () => {
        setSpeaking(false);
        cleanupStreamingAudio();
        if (!receivedAudioChunkRef.current) {
          speakWithBrowserFallback(text);
        }
      };

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      mediaSource.addEventListener("sourceopen", () => {
        if (!mediaSourceRef.current || mediaSourceRef.current.readyState !== "open") return;
        const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        sourceBuffer.mode = "sequence";
        sourceBufferRef.current = sourceBuffer;
        sourceBuffer.addEventListener("updateend", flushQueue);
        flushQueue();
      });

      try {
        const response = await postTtsStream({
          text,
          voice: selectedVoice,
        }, { signal: abortController.signal });
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("tts_stream_body_unavailable");
        }

        setSpeaking(true);
        void audio.play().catch(() => {
          // If autoplay is blocked we still keep buffering and fallback on audio error if needed.
        });

        while (true) {
          if (abortController.signal.aborted) {
            await reader.cancel().catch(() => undefined);
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            receivedAudioChunkRef.current = true;
            appendQueueRef.current.push(
              value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
            );
            flushQueue();
          }
        }

        streamEndedRef.current = true;
        flushQueue();
      } catch (error) {
        console.error("tts_stream_failed", error);
        cleanupStreamingAudio();
        setSpeaking(false);
        if (!receivedAudioChunkRef.current) {
          speakWithBrowserFallback(text);
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [cleanupStreamingAudio, flushQueue, options?.voice, options?.voicePreset, speakWithBrowserFallback, stop],
  );

  useEffect(() => stop, [stop]);

  return {
    supported,
    speaking,
    speak,
    stop,
  };
}
