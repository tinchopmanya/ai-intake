"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { postTtsAudio } from "@/lib/api/client";
import { postTtsStream } from "@/lib/api/client";
import type { SupportedTtsVoice } from "@/lib/api/types";
import type { TtsVoicePreset } from "@/lib/api/types";

type UseSpeechSynthesisOptions = {
  lang?: string;
  voice?: SupportedTtsVoice;
  voicePreset?: TtsVoicePreset;
  onPlaybackStart?: (payload: {
    text: string;
    voice: SupportedTtsVoice;
    audioElement: HTMLAudioElement | null;
    usingStream: boolean;
  }) => void;
  onPlaybackFallback?: (payload: {
    text: string;
    voice: SupportedTtsVoice;
    reason: string;
  }) => void;
  onPlaybackEnd?: () => void;
  onPlaybackError?: (error: unknown) => void;
};

type SpeakOptions = {
  voice?: SupportedTtsVoice;
  voicePreset?: TtsVoicePreset;
};

const TTS_VOICE_PRESETS: Record<TtsVoicePreset, SupportedTtsVoice> = {
  female: "es-AR-ElenaNeural",
  male: "es-ES-AlvaroNeural",
};
const REMOTE_TTS_RETRY_COOLDOWN_MS = 60_000;

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

function getPlaybackErrorCode(error: unknown): string {
  if (typeof error === "string") return error.trim().toLowerCase();
  if (error instanceof Error) return error.message.trim().toLowerCase();
  return "unknown_tts_error";
}

function shouldCooldownRemoteTts(error: unknown): boolean {
  const code = getPlaybackErrorCode(error);
  return (
    code === "tts_dependency_missing" ||
    code === "tts_provider_unavailable" ||
    code === "tts_unavailable" ||
    code === "network_unavailable"
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
  const remoteTtsRetryAtRef = useRef(0);
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
    options?.onPlaybackEnd?.();
  }, [cleanupStreamingAudio, options]);

  const speakWithBrowserFallback = useCallback(
    (text: string, selectedVoice: SupportedTtsVoice) => {
      if (!text.trim() || !canUseBrowserSpeechSynthesis()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.95;
      utterance.pitch = 1.02;
      utterance.onstart = () => {
        setSpeaking(true);
        options?.onPlaybackStart?.({
          text,
          voice: selectedVoice,
          audioElement: null,
          usingStream: false,
        });
      };
      utterance.onend = () => {
        setSpeaking(false);
        activeUtteranceRef.current = null;
        options?.onPlaybackEnd?.();
      };
      utterance.onerror = () => {
        setSpeaking(false);
        activeUtteranceRef.current = null;
        options?.onPlaybackError?.("browser_tts_failed");
        options?.onPlaybackEnd?.();
      };
      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [lang, options],
  );

  const startBrowserFallback = useCallback(
    (payload: { text: string; voice: SupportedTtsVoice; reason: string }) => {
      if (!canUseBrowserSpeechSynthesis()) return false;
      options?.onPlaybackFallback?.(payload);
      speakWithBrowserFallback(payload.text, payload.voice);
      return true;
    },
    [options, speakWithBrowserFallback],
  );

  const playBufferedAudio = useCallback(
    async (payload: {
      text: string;
      voice: SupportedTtsVoice;
      signal?: AbortSignal;
      reason: string;
    }) => {
      const audioBlob = await postTtsAudio(
        {
          text: payload.text,
          voice: payload.voice,
        },
        { signal: payload.signal },
      );
      const audio = new Audio();
      const objectUrl = URL.createObjectURL(audioBlob);
      objectUrlRef.current = objectUrl;
      audioRef.current = audio;
      audio.src = objectUrl;
      audio.preload = "auto";
      audio.onended = () => {
        setSpeaking(false);
        cleanupStreamingAudio();
        options?.onPlaybackEnd?.();
      };
      audio.onerror = () => {
        setSpeaking(false);
        cleanupStreamingAudio();
        if (
          startBrowserFallback({
            text: payload.text,
            voice: payload.voice,
            reason: `${payload.reason}_audio_error`,
          })
        ) {
          return;
        }
        options?.onPlaybackError?.("audio_element_error");
        options?.onPlaybackEnd?.();
      };

      setSpeaking(true);
      options?.onPlaybackFallback?.({
        text: payload.text,
        voice: payload.voice,
        reason: payload.reason,
      });
      options?.onPlaybackStart?.({
        text: payload.text,
        voice: payload.voice,
        audioElement: audio,
        usingStream: false,
      });
      await audio.play();
    },
    [cleanupStreamingAudio, options, startBrowserFallback],
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
        startBrowserFallback({
          text,
          voice: selectedVoice,
          reason: "media_source_streaming_unsupported",
        });
        return;
      }

      if (
        canUseBrowserSpeechSynthesis() &&
        remoteTtsRetryAtRef.current > Date.now()
      ) {
        try {
          await playBufferedAudio({
            text,
            voice: selectedVoice,
            reason: "tts_buffered_fallback",
          });
          return;
        } catch (error) {
          if (
            startBrowserFallback({
              text,
              voice: selectedVoice,
              reason: getPlaybackErrorCode(error),
            })
          ) {
            return;
          }
        }
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
        options?.onPlaybackEnd?.();
      };
      audio.onerror = () => {
        setSpeaking(false);
        cleanupStreamingAudio();
        if (
          !receivedAudioChunkRef.current &&
          startBrowserFallback({
            text,
            voice: selectedVoice,
            reason: "audio_element_error",
          })
        ) {
          return;
        }
        options?.onPlaybackError?.("audio_element_error");
        options?.onPlaybackEnd?.();
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
        options?.onPlaybackStart?.({
          text,
          voice: selectedVoice,
          audioElement: audio,
          usingStream: true,
        });
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
        if (shouldCooldownRemoteTts(error)) {
          remoteTtsRetryAtRef.current = Date.now() + REMOTE_TTS_RETRY_COOLDOWN_MS;
        }
        if (receivedAudioChunkRef.current) {
          streamEndedRef.current = true;
          flushQueue();
          return;
        }
        cleanupStreamingAudio();
        setSpeaking(false);
        if (
          shouldCooldownRemoteTts(error) &&
          !abortController.signal.aborted
        ) {
          try {
            await playBufferedAudio({
              text,
              voice: selectedVoice,
              signal: abortController.signal,
              reason: "tts_buffered_fallback",
            });
            return;
          } catch (bufferedError) {
            console.error("tts_buffered_fallback_failed", bufferedError);
            if (shouldCooldownRemoteTts(bufferedError)) {
              remoteTtsRetryAtRef.current = Date.now() + REMOTE_TTS_RETRY_COOLDOWN_MS;
            }
          }
        }
        if (
          startBrowserFallback({
            text,
            voice: selectedVoice,
            reason: getPlaybackErrorCode(error),
          })
        ) {
          return;
        }
        options?.onPlaybackError?.(error);
        options?.onPlaybackEnd?.();
      } finally {
        abortControllerRef.current = null;
      }
    },
    [cleanupStreamingAudio, flushQueue, options, playBufferedAudio, startBrowserFallback, stop],
  );

  useEffect(() => stop, [stop]);

  return {
    supported,
    speaking,
    speak,
    stop,
  };
}
