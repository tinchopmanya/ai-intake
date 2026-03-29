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
  preferBuffered?: boolean;
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
  const isDevelopment = process.env.NODE_ENV !== "production";
  const optionsRef = useRef(options);
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
  const preferBuffered = options?.preferBuffered ?? false;

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const pushDebug = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!isDevelopment) return;
      if (details) {
        console.debug("[voice][tts]", event, details);
      } else {
        console.debug("[voice][tts]", event);
      }
    },
    [isDevelopment],
  );

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
    pushDebug("stop");
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (canUseBrowserSpeechSynthesis()) {
      window.speechSynthesis.cancel();
    }
    activeUtteranceRef.current = null;
    cleanupStreamingAudio();
    setSpeaking(false);
    optionsRef.current?.onPlaybackEnd?.();
  }, [cleanupStreamingAudio, pushDebug]);

  const speakWithBrowserFallback = useCallback(
    (text: string, selectedVoice: SupportedTtsVoice) => {
      if (!text.trim() || !canUseBrowserSpeechSynthesis()) return;
      pushDebug("browser_fallback_start", { voice: selectedVoice, textLength: text.length });
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.95;
      utterance.pitch = 1.02;
      utterance.onstart = () => {
        setSpeaking(true);
        optionsRef.current?.onPlaybackStart?.({
          text,
          voice: selectedVoice,
          audioElement: null,
          usingStream: false,
        });
      };
      utterance.onend = () => {
        pushDebug("playback_end", { via: "browser", voice: selectedVoice });
        setSpeaking(false);
        activeUtteranceRef.current = null;
        optionsRef.current?.onPlaybackEnd?.();
      };
      utterance.onerror = () => {
        pushDebug("browser_fallback_error", { voice: selectedVoice });
        setSpeaking(false);
        activeUtteranceRef.current = null;
        optionsRef.current?.onPlaybackError?.("browser_tts_failed");
        optionsRef.current?.onPlaybackEnd?.();
      };
      activeUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [lang, pushDebug],
  );

  const startBrowserFallback = useCallback(
    (payload: { text: string; voice: SupportedTtsVoice; reason: string }) => {
      if (!canUseBrowserSpeechSynthesis()) return false;
      pushDebug("browser_fallback_requested", {
        voice: payload.voice,
        reason: payload.reason,
        textLength: payload.text.length,
      });
      optionsRef.current?.onPlaybackFallback?.(payload);
      speakWithBrowserFallback(payload.text, payload.voice);
      return true;
    },
    [pushDebug, speakWithBrowserFallback],
  );

  const playBufferedAudio = useCallback(
    async (payload: {
      text: string;
      voice: SupportedTtsVoice;
      signal?: AbortSignal;
      reason: string;
    }) => {
      pushDebug("buffered_fallback_start", {
        voice: payload.voice,
        reason: payload.reason,
        textLength: payload.text.length,
      });
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
      audio.volume = 1;
      audio.muted = false;
      audio.onended = () => {
        pushDebug("playback_end", { via: "buffered", voice: payload.voice });
        setSpeaking(false);
        cleanupStreamingAudio();
        optionsRef.current?.onPlaybackEnd?.();
      };
      audio.onerror = () => {
        pushDebug("buffered_fallback_audio_error", { voice: payload.voice, reason: payload.reason });
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
        optionsRef.current?.onPlaybackError?.("audio_element_error");
        optionsRef.current?.onPlaybackEnd?.();
      };

      setSpeaking(true);
      pushDebug("playback_start", { via: "buffered", voice: payload.voice });
      optionsRef.current?.onPlaybackFallback?.({
        text: payload.text,
        voice: payload.voice,
        reason: payload.reason,
      });
      optionsRef.current?.onPlaybackStart?.({
        text: payload.text,
        voice: payload.voice,
        audioElement: audio,
        usingStream: false,
      });
      await audio.play();
    },
    [cleanupStreamingAudio, pushDebug, startBrowserFallback],
  );

  const speak = useCallback(
    async (text: string, speakOptions?: SpeakOptions) => {
      if (!text.trim()) return;
      stop();

      const selectedVoice = resolveVoice({
        voice: speakOptions?.voice ?? optionsRef.current?.voice,
        voicePreset: speakOptions?.voicePreset ?? optionsRef.current?.voicePreset,
      });
      pushDebug("speak_requested", { voice: selectedVoice, textLength: text.length });

      if (preferBuffered) {
        await playBufferedAudio({
          text,
          voice: selectedVoice,
          reason: "tts_buffered_preferred",
        });
        return;
      }

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
      audio.volume = 1;
      audio.muted = false;
      audio.onended = () => {
        setSpeaking(false);
        cleanupStreamingAudio();
        optionsRef.current?.onPlaybackEnd?.();
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
        optionsRef.current?.onPlaybackError?.("audio_element_error");
        optionsRef.current?.onPlaybackEnd?.();
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
        pushDebug("stream_request_start", { voice: selectedVoice, textLength: text.length });
        const response = await postTtsStream({
          text,
          voice: selectedVoice,
        }, { signal: abortController.signal });
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("tts_stream_body_unavailable");
        }

        let playbackStarted = false;

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
            if (!playbackStarted) {
              try {
                await audio.play();
                playbackStarted = true;
                setSpeaking(true);
                pushDebug("playback_start", { via: "stream", voice: selectedVoice });
                optionsRef.current?.onPlaybackStart?.({
                  text,
                  voice: selectedVoice,
                  audioElement: audio,
                  usingStream: true,
                });
              } catch (playError) {
                pushDebug("stream_audio_play_failed", {
                  voice: selectedVoice,
                  error: getPlaybackErrorCode(playError),
                });
                throw playError;
              }
            }
          }
        }

        streamEndedRef.current = true;
        flushQueue();
      } catch (error) {
        console.error("tts_stream_failed", error);
        pushDebug("stream_request_failed", {
          voice: selectedVoice,
          error: getPlaybackErrorCode(error),
        });
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
            pushDebug("buffered_fallback_failed", {
              voice: selectedVoice,
              error: getPlaybackErrorCode(bufferedError),
            });
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
        optionsRef.current?.onPlaybackError?.(error);
        optionsRef.current?.onPlaybackEnd?.();
      } finally {
        abortControllerRef.current = null;
      }
    },
    [cleanupStreamingAudio, flushQueue, playBufferedAudio, preferBuffered, pushDebug, startBrowserFallback, stop],
  );

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (canUseBrowserSpeechSynthesis()) {
        window.speechSynthesis.cancel();
      }
      activeUtteranceRef.current = null;
      cleanupStreamingAudio();
    };
  }, [cleanupStreamingAudio]);

  return {
    supported,
    speaking,
    speak,
    stop,
  };
}
