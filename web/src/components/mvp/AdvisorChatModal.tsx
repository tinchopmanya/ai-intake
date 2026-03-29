"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import dynamic from "next/dynamic";

import { Button, Textarea } from "@/components/mvp/ui";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { postAdvisorChat } from "@/lib/api/client";
import { postAdvisorVoice } from "@/lib/api/client";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import type { AdvisorChatRequest, TtsVoicePreset } from "@/lib/api/types";
import styles from "@/components/mvp/AdvisorPopups.module.css";

export type AdvisorChatMessage = {
  id: string;
  role: "user" | "advisor";
  text: string;
};

export type AdvisorChatEntryMode = "advisor_conversation" | "advisor_refine_response";
type VoiceSessionTurn = { role: "user" | "advisor"; text: string };
type AvatarRuntimeState = "loading" | "ready" | "error";
type VoicePerfKey =
  | "modalOpenedAt"
  | "popupOpenedAt"
  | "avatarWarmupStartedAt"
  | "avatarReadyAt"
  | "submitStartedAt"
  | "advisorResponseAt"
  | "ttsStartedAt"
  | "ttsEndedAt";
type VoiceFlowPhase =
  | "countdown"
  | "initializing_media"
  | "user_recording"
  | "user_paused"
  | "sending"
  | "advisor_speaking"
  | "ready_for_next_turn"
  | "error";

type AdvisorChatConversationContext = NonNullable<AdvisorChatRequest["conversation_context"]>;

type AdvisorChatModalProps = {
  isOpen: boolean;
  advisorName: string;
  advisorRole?: string;
  advisorDescription?: string;
  advisorId?: string;
  userName?: string;
  caseId?: string | null;
  advisorAvatarSrc?: string | null;
  messages: AdvisorChatMessage[];
  draft: string;
  sending: boolean;
  entryMode: AdvisorChatEntryMode;
  helperCopy?: string;
  debugPayload?: Record<string, unknown> | null;
  autoSendOnVoiceComplete?: boolean;
  voiceConversationContext?: AdvisorChatConversationContext | null;
  voiceBaseReply?: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onUseResponse: () => void;
  onClose: () => void;
  onVoiceExchangeComplete?: (payload: {
    userText: string;
    advisorText: string;
    suggestedReply: string | null;
    debug?: Record<string, unknown> | null;
  }) => void;
  onVoiceSessionSync?: (payload: {
    turns: VoiceSessionTurn[];
    lastSuggestedReply: string | null;
    debug?: Record<string, unknown> | null;
  }) => void;
};

function getInitials(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function resolveAvatarVariant(src: string | null | undefined, variant: "128" | "256"): string | null {
  if (!src) return null;
  if (variant === "128") return src.replace("_64", "_128").replace("_256", "_128");
  return src.replace("_64", "_256").replace("_128", "_256");
}

type AdvisorAvatarRuntimeConfig = {
  avatarVariant: "female" | "male";
  avatarModelUrl: string;
  avatarLightModelUrl?: string | null;
  voicePreset: TtsVoicePreset;
};

const ADVISOR_AVATAR_RUNTIME_CONFIG: Record<string, AdvisorAvatarRuntimeConfig> = {
  laura: {
    avatarVariant: "female",
    avatarModelUrl: "/advisors/laura.glb",
    avatarLightModelUrl: null,
    voicePreset: "female",
  },
  lidia: {
    avatarVariant: "female",
    avatarModelUrl: "/advisors/lidia.glb",
    avatarLightModelUrl: null,
    voicePreset: "female",
  },
  robert: {
    avatarVariant: "male",
    avatarModelUrl: "/advisors/robert.glb",
    avatarLightModelUrl: null,
    voicePreset: "male",
  },
};

type AdvisorAvatarDeliverySelection = {
  modelUrl: string;
  qualityTier: "full" | "light";
  supportsUpgrade: boolean;
  performancePreset: "balanced" | "economy";
};

function resolveAdvisorAvatarDelivery(config: AdvisorAvatarRuntimeConfig): AdvisorAvatarDeliverySelection {
  const qualityPreference =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ADVISOR_AVATAR_QUALITY?.trim().toLowerCase() : "";
  const connection = typeof navigator !== "undefined"
    ? (navigator as Navigator & {
        connection?: { effectiveType?: string; saveData?: boolean };
      }).connection
    : undefined;
  const deviceMemory =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null
      : null;
  const prefersLightweight =
    qualityPreference === "light" ||
    (qualityPreference !== "full" &&
      Boolean(config.avatarLightModelUrl) &&
      (
        connection?.saveData === true ||
        connection?.effectiveType === "slow-2g" ||
        connection?.effectiveType === "2g" ||
        connection?.effectiveType === "3g" ||
        (deviceMemory !== null && deviceMemory <= 4)
      ));
  return {
    modelUrl: prefersLightweight && config.avatarLightModelUrl ? config.avatarLightModelUrl : config.avatarModelUrl,
    qualityTier: prefersLightweight && config.avatarLightModelUrl ? "light" : "full",
    supportsUpgrade: Boolean(config.avatarLightModelUrl),
    performancePreset:
      deviceMemory !== null && deviceMemory <= 4 ? "economy" : "balanced",
  };
}

function getAdvisorAvatarRuntimeConfig(advisorId?: string): AdvisorAvatarRuntimeConfig {
  if (!advisorId) {
    return ADVISOR_AVATAR_RUNTIME_CONFIG.laura;
  }
  return ADVISOR_AVATAR_RUNTIME_CONFIG[advisorId] ?? ADVISOR_AVATAR_RUNTIME_CONFIG.laura;
}

const AdvisorAvatar3D = dynamic(
  () => import("@/components/mvp/AdvisorAvatar3D").then((mod) => mod.AdvisorAvatar3D),
  { ssr: false },
);

export function AdvisorChatModal({
  isOpen,
  advisorName,
  advisorRole,
  advisorDescription,
  advisorId,
  userName = "",
  caseId = null,
  advisorAvatarSrc,
  messages,
  draft,
  sending,
  entryMode,
  helperCopy,
  debugPayload,
  autoSendOnVoiceComplete = true,
  voiceConversationContext = null,
  voiceBaseReply = null,
  onDraftChange,
  onSend,
  onUseResponse,
  onClose,
  onVoiceExchangeComplete,
  onVoiceSessionSync,
}: AdvisorChatModalProps) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceTranscriptOpen, setVoiceTranscriptOpen] = useState(false);
  const [voiceSendError, setVoiceSendError] = useState<string | null>(null);
  const [voicePlaybackNotice, setVoicePlaybackNotice] = useState<string | null>(null);
  const [voiceTurns, setVoiceTurns] = useState<VoiceSessionTurn[]>([]);
  const [voiceChatExpanded, setVoiceChatExpanded] = useState(false);
  const [finalizeInFlight, setFinalizeInFlight] = useState(false);
  const [readyForNextTurn, setReadyForNextTurn] = useState(false);
  const autoStartGuardRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const wasSpeakingRef = useRef(false);
  const [avatarPlaybackId, setAvatarPlaybackId] = useState(0);
  const [avatarAudioElement, setAvatarAudioElement] = useState<HTMLAudioElement | null>(null);
  const [avatarSpeechText, setAvatarSpeechText] = useState<string>("");
  const [avatarRuntimeState, setAvatarRuntimeState] = useState<AvatarRuntimeState>("loading");
  const perfMarksRef = useRef<Record<VoicePerfKey, number | null>>({
    modalOpenedAt: null,
    popupOpenedAt: null,
    avatarWarmupStartedAt: null,
    avatarReadyAt: null,
    submitStartedAt: null,
    advisorResponseAt: null,
    ttsStartedAt: null,
    ttsEndedAt: null,
  });
  const previousAvatarRuntimeStateRef = useRef<AvatarRuntimeState>("loading");
  const avatarColdStartMsRef = useRef<number | null>(null);
  const lastPopupOpenReadyMsRef = useRef<number | null>(null);

  const pushMetric = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!isDevelopment) return;
      if (details) {
        console.log("[voice][metrics]", event, details);
      } else {
        console.log("[voice][metrics]", event);
      }
    },
    [isDevelopment],
  );

  const markPerf = useCallback((key: VoicePerfKey) => {
    perfMarksRef.current[key] = performance.now();
    return perfMarksRef.current[key];
  }, []);

  const getElapsed = useCallback((key: VoicePerfKey) => {
    const mark = perfMarksRef.current[key];
    return mark === null ? null : Math.round(performance.now() - mark);
  }, []);

  const headerAvatar = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "128"), [advisorAvatarSrc]);
  const heroAvatar = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "256"), [advisorAvatarSrc]);
  const advisorAvatarRuntimeBase = useMemo(() => getAdvisorAvatarRuntimeConfig(advisorId), [advisorId]);
  const advisorAvatarRuntime = useMemo(
    () => ({
      ...advisorAvatarRuntimeBase,
      ...resolveAdvisorAvatarDelivery(advisorAvatarRuntimeBase),
    }),
    [advisorAvatarRuntimeBase],
  );
  const syncVoiceTurnsLive = Boolean(onVoiceSessionSync);
  const preferredVoiceLang = useMemo(
    () =>
      typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es-uy")
        ? "es-UY"
        : "es-ES",
    [],
  );
  const recorder = useVoiceRecorder({ lang: preferredVoiceLang, countdownSeconds: 3 });
  const speechSynthesis = useSpeechSynthesis({
    lang: preferredVoiceLang,
    voicePreset: advisorAvatarRuntimeBase.voicePreset,
    preferBuffered: true,
    onPlaybackFallback: () => {
      setVoicePlaybackNotice("La voz natural no estuvo disponible. Seguimos con la voz del navegador.");
    },
    onPlaybackStart: ({ audioElement, text }) => {
      markPerf("ttsStartedAt");
      pushMetric("tts_playback_started", {
        textLength: text.length,
        popupToAudioMs: getElapsed("popupOpenedAt"),
        submitToAudioMs: getElapsed("submitStartedAt"),
        advisorToAudioMs: getElapsed("advisorResponseAt"),
      });
      setAvatarAudioElement(audioElement);
      setAvatarSpeechText(text);
      setAvatarPlaybackId((current) => current + 1);
    },
    onPlaybackEnd: () => {
      markPerf("ttsEndedAt");
      pushMetric("tts_playback_ended", {
        playbackDurationMs:
          perfMarksRef.current.ttsStartedAt !== null
            ? Math.round((perfMarksRef.current.ttsEndedAt ?? performance.now()) - perfMarksRef.current.ttsStartedAt)
            : null,
        submitToEndMs: getElapsed("submitStartedAt"),
      });
      setAvatarAudioElement(null);
      setAvatarSpeechText("");
    },
    onPlaybackError: () => {
      setAvatarAudioElement(null);
      setAvatarSpeechText("");
      setVoicePlaybackNotice("La respuesta se mostro en texto, pero no pudimos reproducir la voz.");
    },
  });
  const voiceSpeaking = speechSynthesis.speaking;

  useEffect(() => {
    if (!isOpen) return;
    markPerf("modalOpenedAt");
    perfMarksRef.current.avatarWarmupStartedAt = performance.now();
    perfMarksRef.current.avatarReadyAt = null;
    avatarColdStartMsRef.current = null;
    lastPopupOpenReadyMsRef.current = null;
    previousAvatarRuntimeStateRef.current = "loading";
    pushMetric("modal_warmup_started", {
      advisorId: advisorId ?? "unknown",
      qualityTier: advisorAvatarRuntime.qualityTier,
      performancePreset: advisorAvatarRuntime.performancePreset,
      supportsUpgrade: advisorAvatarRuntime.supportsUpgrade,
    });
  }, [advisorAvatarRuntime.performancePreset, advisorAvatarRuntime.qualityTier, advisorAvatarRuntime.supportsUpgrade, advisorId, isOpen, markPerf, pushMetric]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = previousAvatarRuntimeStateRef.current;
    if (previous === avatarRuntimeState) return;
    previousAvatarRuntimeStateRef.current = avatarRuntimeState;
    if (avatarRuntimeState === "ready") {
      markPerf("avatarReadyAt");
      avatarColdStartMsRef.current =
        perfMarksRef.current.avatarWarmupStartedAt !== null
          ? Math.round((perfMarksRef.current.avatarReadyAt ?? performance.now()) - perfMarksRef.current.avatarWarmupStartedAt)
          : null;
      const popupReadyMs =
        perfMarksRef.current.popupOpenedAt !== null
          ? Math.round((perfMarksRef.current.avatarReadyAt ?? performance.now()) - perfMarksRef.current.popupOpenedAt)
          : 0;
      lastPopupOpenReadyMsRef.current = Math.max(0, popupReadyMs);
      pushMetric("avatar_runtime_ready", {
        warmupMs: avatarColdStartMsRef.current,
        popupToReadyMs: perfMarksRef.current.popupOpenedAt !== null ? lastPopupOpenReadyMsRef.current : null,
        qualityTier: advisorAvatarRuntime.qualityTier,
      });
      if (perfMarksRef.current.popupOpenedAt !== null) {
        pushMetric("before_after_avatar_ready", {
          beforeMs: avatarColdStartMsRef.current,
          afterMs: lastPopupOpenReadyMsRef.current,
          deltaMs:
            avatarColdStartMsRef.current !== null && lastPopupOpenReadyMsRef.current !== null
              ? avatarColdStartMsRef.current - lastPopupOpenReadyMsRef.current
              : null,
          deltaPct:
            avatarColdStartMsRef.current && lastPopupOpenReadyMsRef.current !== null
              ? Math.round(((avatarColdStartMsRef.current - lastPopupOpenReadyMsRef.current) / avatarColdStartMsRef.current) * 100)
              : null,
        });
      }
    } else {
      pushMetric("avatar_runtime_state", {
        state: avatarRuntimeState,
        popupElapsedMs: getElapsed("popupOpenedAt"),
      });
    }
  }, [advisorAvatarRuntime.qualityTier, avatarRuntimeState, getElapsed, isOpen, markPerf, pushMetric]);

  useEffect(() => {
    if (!isOpen) return;
    void import("@/components/mvp/AdvisorAvatar3D").then((mod) => {
      mod.preloadAdvisorAvatarAssets?.(advisorAvatarRuntime.modelUrl);
    });
  }, [advisorAvatarRuntime.modelUrl, isOpen]);

  useEffect(() => {
    if (!voiceChatExpanded) return;
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [voiceChatExpanded, voiceTurns, recorder.transcript, recorder.status]);

  useEffect(() => {
    if (!voiceOpen) {
      autoStartGuardRef.current = false;
      return;
    }
    if (autoStartGuardRef.current) return;
    if (avatarRuntimeState === "loading") return;
    autoStartGuardRef.current = true;
    recorder.startFlow();
  }, [avatarRuntimeState, recorder, voiceOpen]);

  useEffect(() => {
    if (!voiceOpen) return;
    const wasSpeaking = wasSpeakingRef.current;
    if (voiceSpeaking) {
      wasSpeakingRef.current = true;
      return;
    }
    if (wasSpeaking) {
      wasSpeakingRef.current = false;
      setReadyForNextTurn(true);
      recorder.setStatus("idle");
    }
  }, [recorder, voiceOpen, voiceSpeaking]);

  const voiceLiveTranscript = recorder.transcript.trim();
  const avatarBooting = voiceOpen && avatarRuntimeState === "loading";
  const canUseSuggestedReply = entryMode === "advisor_refine_response";
  const flowPhase: VoiceFlowPhase =
    voiceSpeaking
      ? "advisor_speaking"
      : recorder.status === "countdown"
        ? "countdown"
        : recorder.status === "initializing_media"
          ? "initializing_media"
          : recorder.status === "recording"
            ? "user_recording"
            : recorder.status === "recording_no_transcript"
              ? "user_paused"
              : recorder.status === "sending" || finalizeInFlight
                ? "sending"
                : recorder.status === "error"
                  ? "error"
                  : readyForNextTurn
                    ? "ready_for_next_turn"
                    : "ready_for_next_turn";

  const statusText =
    avatarBooting
      ? "Preparando el avatar..."
      : flowPhase === "countdown"
      ? `Iniciando en ${recorder.countdown} segundo${recorder.countdown === 1 ? "" : "s"}...`
      : flowPhase === "initializing_media"
        ? "Preparando dictado..."
      : flowPhase === "user_recording"
        ? "Escuchando tu dictado..."
        : flowPhase === "user_paused"
          ? "Grabando audio. Si el navegador transcribe, veras el dictado en vivo."
          : flowPhase === "sending" || recorder.status === "stopping"
            ? "Enviando dictado..."
            : flowPhase === "advisor_speaking"
              ? "Respondiendo a partir del dictado..."
              : flowPhase === "ready_for_next_turn"
                ? "Listo para dictar de nuevo."
                : flowPhase === "error"
                ? "No pudimos procesar el dictado."
                : "Preparando...";

  const stopTts = useCallback(() => {
    speechSynthesis.stop();
    setReadyForNextTurn(true);
    recorder.setStatus("idle");
  }, [recorder, speechSynthesis]);

  const commitVoiceSession = useCallback(() => {
    if (voiceTurns.length === 0) return;
    if (onVoiceSessionSync) return;
    if (onVoiceExchangeComplete) {
      for (let index = 0; index < voiceTurns.length - 1; index += 2) {
        const userTurn = voiceTurns[index];
        const advisorTurn = voiceTurns[index + 1];
        if (!userTurn || !advisorTurn || userTurn.role !== "user" || advisorTurn.role !== "advisor") continue;
        onVoiceExchangeComplete({
          userText: userTurn.text,
          advisorText: advisorTurn.text,
          suggestedReply: null,
          debug: null,
        });
      }
    }
  }, [onVoiceExchangeComplete, onVoiceSessionSync, voiceTurns]);

  const closeVoice = useCallback(
    ({ commit = true }: { commit?: boolean } = {}) => {
      if (commit) commitVoiceSession();
      stopTts();
      recorder.resetRecording();
      setVoiceOpen(false);
      setVoiceTranscriptOpen(false);
      setVoiceSendError(null);
      setVoicePlaybackNotice(null);
      setVoiceTurns([]);
      setFinalizeInFlight(false);
      setVoiceChatExpanded(false);
      setAvatarAudioElement(null);
      setAvatarSpeechText("");
    },
    [commitVoiceSession, recorder, stopTts],
  );

  const sendVoice = useCallback(
    async (payload: { audioBlob: Blob | null; transcript: string }) => {
      try {
        if (!advisorId) {
          recorder.setStatus("error");
          setVoiceSendError("No se encontro el advisor seleccionado. Volve a intentarlo.");
          return;
        }
        const transcriptText = payload.transcript.trim() || voiceLiveTranscript;
        if (!transcriptText && !payload.audioBlob) {
          recorder.setStatus("error");
          setVoiceSendError("No pudimos recuperar tu dictado. Intenta nuevamente.");
          return;
        }
        const userVoiceText = transcriptText || "Mensaje de voz";
        markPerf("submitStartedAt");
        pushMetric("advisor_submit_started", {
          transcriptLength: userVoiceText.length,
          hasAudio: Boolean(payload.audioBlob),
          popupElapsedMs: getElapsed("popupOpenedAt"),
        });

        recorder.setStatus("sending");
        setVoiceSendError(null);
        setVoicePlaybackNotice(null);
        const history = syncVoiceTurnsLive
          ? messages.map((item) => ({ role: item.role, content: item.text }))
          : [
              ...messages.map((item) => ({ role: item.role, content: item.text })),
              ...voiceTurns.map((item) => ({ role: item.role, content: item.text })),
            ];
        const conversationContext = {
          user_name: (voiceConversationContext?.user_name ?? userName) || null,
          ex_name: voiceConversationContext?.ex_name ?? null,
          has_children: voiceConversationContext?.has_children ?? null,
          relationship_type: voiceConversationContext?.relationship_type ?? "otro",
          extra: {
            ...(voiceConversationContext?.extra ?? {}),
            voice_flow: true,
          },
        };
        const baseReply =
          entryMode === "advisor_refine_response" ? voiceBaseReply?.trim() || null : null;
        const outboundMessages = [...history, { role: "user" as const, content: userVoiceText }];
        const result = payload.audioBlob
          ? await postAdvisorVoice({
              advisor_id: advisorId,
              entry_mode: entryMode,
              transcript: userVoiceText,
              audio_blob: payload.audioBlob,
              audio_mime_type: payload.audioBlob.type,
              messages: outboundMessages,
              case_id: caseId,
              conversation_context: conversationContext,
              base_reply: baseReply,
              debug: isDevelopment,
            })
          : await postAdvisorChat({
              advisor_id: advisorId,
              entry_mode: entryMode,
              messages: outboundMessages,
              case_id: caseId,
              conversation_context: conversationContext,
              base_reply: baseReply,
              debug: isDevelopment,
            });

        const advisorReply = result.message.trim() || "No pude responder ahora. Intenta nuevamente.";
        markPerf("advisorResponseAt");
        pushMetric("advisor_response_received", {
          submitToResponseMs: getElapsed("submitStartedAt"),
          popupToResponseMs: getElapsed("popupOpenedAt"),
          replyLength: advisorReply.length,
        });
        const newTurns: VoiceSessionTurn[] = [
          { role: "user", text: userVoiceText },
          { role: "advisor", text: advisorReply },
        ];
        setVoiceTurns((previous) => [
          ...previous,
          ...newTurns,
        ]);
        setReadyForNextTurn(false);
        if (onVoiceSessionSync) {
          onVoiceSessionSync({
            turns: newTurns,
            lastSuggestedReply: result.suggested_reply,
            debug: result.debug ?? null,
          });
        }
        void speechSynthesis.speak(advisorReply);
        recorder.resetRecording();
        recorder.setStatus("idle");

        if (!onVoiceSessionSync && !onVoiceExchangeComplete) {
          onDraftChange(userVoiceText);
          if (autoSendOnVoiceComplete) {
            window.setTimeout(() => onSend(), 0);
          }
        }
      } catch (error) {
        recorder.setStatus("error");
        setVoiceSendError(
          error instanceof Error && error.message.trim()
            ? error.message
            : "No pudimos enviar la grabacion. Intenta de nuevo.",
        );
      } finally {
        setFinalizeInFlight(false);
      }
    },
    [
      advisorId,
      autoSendOnVoiceComplete,
      caseId,
      entryMode,
      getElapsed,
      isDevelopment,
      markPerf,
      messages,
      onDraftChange,
      onSend,
      onVoiceExchangeComplete,
      onVoiceSessionSync,
      pushMetric,
      recorder,
      speechSynthesis,
      syncVoiceTurnsLive,
      userName,
      voiceBaseReply,
      voiceConversationContext,
      voiceLiveTranscript,
      voiceTurns,
    ],
  );

  const handleFinalize = useCallback(async () => {
    if (
      finalizeInFlight ||
      recorder.status === "countdown" ||
      recorder.status === "initializing_media" ||
      recorder.status === "sending"
    ) {
      return;
    }
    setFinalizeInFlight(true);
    const payload = await recorder.finalizeRecording();
    await sendVoice(payload);
  }, [finalizeInFlight, recorder, sendVoice]);

  const beginNextTurnRecording = useCallback(async () => {
    if (finalizeInFlight || flowPhase === "sending" || flowPhase === "initializing_media") return;
    setVoiceSendError(null);
    setVoicePlaybackNotice(null);
    setReadyForNextTurn(false);
    recorder.resetRecording();
    await recorder.startRecording();
  }, [finalizeInFlight, flowPhase, recorder]);

  const handlePrimaryVoiceAction = useCallback(async () => {
    if (flowPhase === "advisor_speaking") {
      stopTts();
      return;
    }
    if (
      flowPhase === "ready_for_next_turn" ||
      flowPhase === "error" ||
      (flowPhase === "user_paused" && !voiceLiveTranscript)
    ) {
      await beginNextTurnRecording();
      return;
    }
    if (
      flowPhase === "countdown" ||
      flowPhase === "initializing_media" ||
      flowPhase === "sending"
    ) {
      return;
    }
    await handleFinalize();
  }, [beginNextTurnRecording, flowPhase, handleFinalize, stopTts, voiceLiveTranscript]);

  if (!isOpen) return null;

  const helperText =
    helperCopy ||
    (entryMode === "advisor_conversation"
      ? `Como estas hoy${userName ? `, ${userName}` : ""}? En que te puedo ayudar?`
      : "Contame que queres ajustar y lo mejoramos juntos.");
  const inputPlaceholder =
    entryMode === "advisor_conversation" ? "Escribi tu mensaje..." : "Escribi como queres ajustarlo...";

  const openVoice = () => {
    markPerf("popupOpenedAt");
    perfMarksRef.current.submitStartedAt = null;
    perfMarksRef.current.advisorResponseAt = null;
    perfMarksRef.current.ttsStartedAt = null;
    perfMarksRef.current.ttsEndedAt = null;
    pushMetric("popup_opened", {
      advisorId: advisorId ?? "unknown",
      avatarRuntimeState,
      coldAvatarWarmupMs: avatarColdStartMsRef.current,
      expandedDefault:
        typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false,
    });
    if (avatarRuntimeState === "ready") {
      lastPopupOpenReadyMsRef.current = 0;
      pushMetric("before_after_avatar_ready", {
        beforeMs: avatarColdStartMsRef.current,
        afterMs: 0,
        deltaMs: avatarColdStartMsRef.current,
        deltaPct: avatarColdStartMsRef.current ? 100 : null,
      });
    }
    setVoiceTranscriptOpen(false);
    setVoiceSendError(null);
    setVoicePlaybackNotice(null);
    setVoiceTurns([]);
    setFinalizeInFlight(false);
    setReadyForNextTurn(false);
    const desktopDefault =
      typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false;
    setVoiceChatExpanded(desktopDefault);
    setVoiceOpen(true);
  };

  const voiceWarmupCopy =
    avatarRuntimeState === "ready"
      ? "Voz del advisor lista"
      : avatarRuntimeState === "error"
        ? "Avatar no disponible, puedes usar voz igualmente"
        : "Preparando avatar de voz...";

  const voiceOverlay =
    typeof document !== "undefined" && isOpen
      ? createPortal(
          <div className={`${styles.vpOverlay} ${voiceOpen ? "" : styles.vpOverlayHidden}`} aria-hidden={!voiceOpen}>
            <div className={`relative ${styles.vpModalFrame} ${voiceChatExpanded ? styles.vpModalFrameExpanded : ""}`}>
              <button type="button" onClick={() => closeVoice()} className={styles.vpClose} aria-label="Cerrar">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 2 12 12M12 2 2 12" />
                </svg>
              </button>
              <div className={styles.vpCard}>
                <div className="relative flex h-full flex-col lg:flex-row">
                  <section className={`${styles.vpBody} ${styles.vpShellSection} ${voiceChatExpanded ? styles.vpBodySplit : ""} ${voiceChatExpanded ? "lg:w-[440px] lg:shrink-0" : "lg:w-full"}`}>
                    <header className={styles.vpHeader}>
                      {headerAvatar ? (
                        <Image src={headerAvatar} alt={advisorName} width={48} height={48} priority className={styles.vpAvatar} />
                      ) : (
                        <span className={styles.vpAvatarFallback}>{(getInitials(advisorName) || "A")[0]}</span>
                      )}
                      <div className={styles.vpHeadText}>
                        <p className={styles.vpName}>{advisorName}</p>
                        {advisorRole ? <p className={styles.vpSub}>{advisorRole}</p> : null}
                      </div>
                    </header>

                    <div className={styles.vpShellContent}>
                      <button
                        type="button"
                        onClick={() => setVoiceChatExpanded((prev) => !prev)}
                        className={`${styles.vpToggle} absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 px-2 py-6 lg:inline-flex`}
                        aria-label={voiceChatExpanded ? "Contraer chat" : "Expandir chat"}
                      >
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-4 w-4 transition-transform ${voiceChatExpanded ? "rotate-180" : ""}`}>
                          <path d="m7 4 6 6-6 6" />
                        </svg>
                      </button>

                      <div className={styles.vpAvatarStage}>
                        <span className={`${styles.vpRing} ${styles.vpRing1} ${voiceSpeaking ? styles.vpRingSpeaking : ""} ${(flowPhase === "user_recording" || flowPhase === "user_paused") ? styles.vpRingListening : ""}`} />
                        <span className={`${styles.vpRing} ${styles.vpRing2} ${voiceSpeaking ? styles.vpRingSpeaking : ""} ${(flowPhase === "user_recording" || flowPhase === "user_paused") ? styles.vpRingListening : ""}`} />
                        <span className={`${styles.vpRing} ${styles.vpRing3} ${voiceSpeaking ? styles.vpRingSpeaking : ""} ${(flowPhase === "user_recording" || flowPhase === "user_paused") ? styles.vpRingListening : ""}`} />
                        <button
                          type="button"
                          onClick={() => {
                            if (voiceSpeaking) stopTts();
                          }}
                          disabled={!voiceSpeaking}
                          className={`${styles.vpAvatarButton} ${voiceSpeaking ? "cursor-pointer" : "cursor-default"}`}
                          aria-label={voiceSpeaking ? "Detener voz del advisor" : "Avatar del advisor"}
                        >
                          <AdvisorAvatar3D
                            audioElement={avatarAudioElement}
                            speechText={avatarSpeechText}
                            isSpeaking={voiceSpeaking}
                            avatarVariant={advisorAvatarRuntime.avatarVariant}
                            modelUrl={advisorAvatarRuntime.modelUrl}
                            fallbackImageSrc={heroAvatar}
                            label={advisorName}
                            playbackId={avatarPlaybackId}
                            width={236}
                            height={320}
                            onRuntimeStateChange={setAvatarRuntimeState}
                          />
                        </button>
                        {recorder.status === "countdown" ? <span className={styles.vpCountdown}>{recorder.countdown}</span> : null}
                      </div>

                      <div className={styles.vpMeta}>
                        <p className={styles.vpNameSmall}>{advisorName}</p>
                        {advisorRole ? <p className={styles.vpSub}>{advisorRole}</p> : null}
                        {advisorDescription ? <p className={styles.vpDesc}>{advisorDescription}</p> : null}
                        <p className={`${styles.vpStatus} ${flowPhase === "user_recording" ? styles.vpStatusRecording : ""} ${flowPhase === "user_paused" ? styles.vpStatusPaused : ""} ${flowPhase === "advisor_speaking" ? styles.vpStatusSpeaking : ""} ${flowPhase === "sending" ? styles.vpStatusSending : ""}`}>{statusText}</p>
                      </div>

                      <div className="mb-3 mt-4 flex h-9 items-center gap-[3px]">
                        {Array.from({ length: 12 }).map((_, index) => (
                          <span
                            key={`wave-${index}`}
                            className={`${styles.vpWaveBar} ${flowPhase === "user_recording" || flowPhase === "advisor_speaking" ? styles.vpWaveActive : styles.vpWavePaused}`}
                            style={{ animationDelay: `${index * 0.1}s` }}
                          />
                        ))}
                      </div>
                      <button type="button" onClick={() => setVoiceTranscriptOpen((prev) => !prev)} className={styles.vpHintBtn}>
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-3 w-3 transition-transform ${voiceTranscriptOpen ? "rotate-90" : ""}`}>
                          <path d="M4 2l4 4-4 4" />
                        </svg>
                        ver dictado
                      </button>
                      <div className={`${styles.vpHintBox} ${voiceTranscriptOpen ? styles.vpHintOpen : styles.vpHintClosed}`}>
                        Esta experiencia usa el dictado del navegador. El advisor responde a partir de la transcripcion.
                      </div>
                      {avatarRuntimeState === "error" ? (
                        <p className={styles.vpAvatarNotice}>
                          No pudimos cargar el avatar ahora mismo. Puedes seguir usando el advisor igualmente.
                        </p>
                      ) : null}
                      {voiceSendError || recorder.errorMessage ? <p className={styles.vpError}>{voiceSendError ?? recorder.errorMessage}</p> : null}
                      {voicePlaybackNotice ? (
                        <p className={styles.vpPlaybackNotice}>{voicePlaybackNotice}</p>
                      ) : null}
                      <div className="mt-auto flex w-full gap-2.5">
                        <button
                          type="button"
                          onClick={() => void handlePrimaryVoiceAction()}
                          disabled={avatarBooting || finalizeInFlight || flowPhase === "countdown" || flowPhase === "initializing_media" || flowPhase === "sending"}
                          className={styles.vpPrimaryBtn}
                        >
                          {avatarBooting
                            ? "Preparando avatar"
                            : flowPhase === "advisor_speaking"
                              ? "Detener"
                              : flowPhase === "ready_for_next_turn" || flowPhase === "error"
                                ? "Volver a dictar"
                                : "Enviar dictado"}
                        </button>
                        <button type="button" onClick={() => closeVoice()} className={styles.vpSecondaryBtn}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  </section>

                  {voiceChatExpanded ? (
                    <aside className={`${styles.vpChatAside} hidden h-full min-h-0 w-[420px] shrink-0 lg:flex lg:flex-col`}>
                      <div className={styles.vpChatHead}>
                        <p className={styles.vpChatHeadText}>Conversacion</p>
                      </div>
                      <div ref={chatScrollRef} className={`${styles.vpChatList} min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3`}>
                        {voiceTurns.map((turn, index) => (
                          <div key={`turn-${index}-${turn.role}`} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={turn.role === "user" ? "max-w-[76%]" : "max-w-[82%]"}>
                              <p className={turn.role === "user" ? styles.vpLabelUser : styles.vpLabelAdvisor}>
                                {turn.role === "user" ? "TU VOZ" : advisorName.toUpperCase()}
                              </p>
                              <div className={`whitespace-pre-wrap break-words px-[12px] py-[9px] text-[13px] leading-[1.55] ${turn.role === "user" ? styles.vpBubbleUser : styles.vpBubbleAdvisor}`}>
                                {turn.text}
                              </div>
                            </div>
                          </div>
                        ))}

                        {(flowPhase === "user_recording" || flowPhase === "user_paused" || recorder.status === "stopping" || flowPhase === "sending" || finalizeInFlight) && voiceLiveTranscript ? (
                          <div className="flex justify-end">
                            <div className="max-w-[76%]">
                              <p className={styles.vpLabelUser}>TU VOZ</p>
                              <div className={`px-[12px] py-[9px] text-[13px] leading-[1.55] ${styles.vpBubbleLive}`}>
                                {voiceLiveTranscript}
                                {flowPhase === "user_recording" && recorder.transcribing ? <span className={styles.vpLiveCaret} /> : null}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </aside>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className={styles.cpOverlay}>
        <div className="relative w-full max-w-[560px]">
          <button
            type="button"
            onClick={() => {
              if (voiceOpen) closeVoice();
              onClose();
            }}
            className={styles.cpClose}
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2 12 12M12 2 2 12" />
            </svg>
          </button>
          <div className={`${styles.cpPanel} relative flex h-[min(92vh,760px)] w-full flex-col`}>
            <header className={styles.cpHeader}>
              {headerAvatar ? (
                <Image src={headerAvatar} alt={advisorName} width={48} height={48} className={styles.cpAvatar} />
              ) : (
                <span className={styles.cpAvatarFallback}>{(getInitials(advisorName) || "A")[0]}</span>
              )}
              <div className={styles.cpHeadText}>
                <p className={styles.cpName}>{advisorName}</p>
                {advisorRole ? <p className={styles.cpSub}>{advisorRole}</p> : null}
                {advisorDescription ? <p className={styles.cpDesc}>{advisorDescription}</p> : null}
              </div>
            </header>

            <div className={`${styles.cpBody} flex min-h-0 flex-1 flex-col`}>
              <div className={`${styles.cpConversation} min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-5`}>
                {messages.length === 0 ? (
                  <div className="max-w-[80%]">
                    <p className={styles.cpLabelAdvisor}>{advisorName.toUpperCase()}</p>
                    <div className={`${styles.cpBubbleAdvisor} px-4 py-3 text-[14px] leading-[1.55]`}>{helperText}</div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {messages.map((message) => (
                      <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={message.role === "user" ? "max-w-[70%]" : "max-w-[80%]"}>
                          <p className={message.role === "user" ? styles.cpLabelUser : styles.cpLabelAdvisor}>
                            {message.role === "user" ? "TU" : advisorName.toUpperCase()}
                          </p>
                          <div className={`whitespace-pre-wrap break-words px-[14px] py-[10px] text-[14px] leading-[1.55] ${message.role === "user" ? styles.cpBubbleUser : styles.cpBubbleAdvisor}`}>
                            {message.text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <footer className={`${styles.cpFooter} px-4 py-3`}>
              <div className="mb-2 flex items-end gap-2">
                <Textarea id="advisor-chat-draft" value={draft} onChange={(event) => onDraftChange(event.target.value)} rows={1} spellCheck={false} placeholder={inputPlaceholder} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!sending && draft.trim()) onSend(); } }} className={`${styles.cpTextarea} min-h-[42px] max-h-[120px] flex-1 px-[14px] py-[10px] text-[14px] focus:ring-0`} />
                <button type="button" onClick={openVoice} className={styles.cpMicBtn} aria-label="Dictar para el advisor"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 19v3" /><path d="M8 22h8" /></svg></button>
                <Button type="button" variant="primary" disabled={sending || !draft.trim()} onClick={onSend} className={`${styles.cpSendBtn} h-[42px] px-[18px] text-[14px] font-semibold`}>{sending ? "Enviando..." : "Enviar"}</Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                {canUseSuggestedReply ? (
                  <Button type="button" variant="secondary" onClick={onUseResponse} className={`${styles.cpUseBtn} px-[14px] py-[7px] text-[13px]`}>Usar respuesta sugerida</Button>
                ) : <span />}
                <div className="flex items-center gap-3">
                  <span className={styles.cpVoiceWarmupStatus}>{voiceWarmupCopy}</span>
                  {isDevelopment && debugPayload ? <details className="text-right"><summary className="cursor-pointer text-[11px]">Debug prompt (solo desarrollo)</summary><pre className="mt-2 max-h-40 overflow-auto rounded-lg p-2 text-left text-[11px]">{JSON.stringify(debugPayload, null, 2)}</pre></details> : null}
                </div>
              </div>
            </footer>
            </div>
          </div>
        </div>
      </div>
      {voiceOverlay}
    </>
  );
}
