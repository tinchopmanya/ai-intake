"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import dynamic from "next/dynamic";

import { Button, Textarea } from "@/components/mvp/ui";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { postAdvisorVoice } from "@/lib/api/client";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import styles from "@/components/mvp/AdvisorPopups.module.css";

export type AdvisorChatMessage = {
  id: string;
  role: "user" | "advisor";
  text: string;
};

export type AdvisorChatEntryMode = "advisor_conversation" | "advisor_refine_response";
type VoiceSessionTurn = { role: "user" | "advisor"; text: string };
type VoiceFlowPhase =
  | "countdown"
  | "initializing_media"
  | "user_recording"
  | "user_paused"
  | "sending"
  | "advisor_speaking"
  | "ready_for_next_turn"
  | "error";

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

function getAdvisorAvatarVariant(advisorId?: string): "female" | "male" {
  return advisorId === "robert" ? "male" : "female";
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
  const [voiceTurns, setVoiceTurns] = useState<VoiceSessionTurn[]>([]);
  const [voiceLastSuggestedReply, setVoiceLastSuggestedReply] = useState<string | null>(null);
  const [voiceLastDebug, setVoiceLastDebug] = useState<Record<string, unknown> | null>(null);
  const [voiceChatExpanded, setVoiceChatExpanded] = useState(false);
  const [finalizeInFlight, setFinalizeInFlight] = useState(false);
  const [readyForNextTurn, setReadyForNextTurn] = useState(false);
  const autoStartGuardRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const wasSpeakingRef = useRef(false);
  const [avatarPlaybackId, setAvatarPlaybackId] = useState(0);
  const [avatarAudioElement, setAvatarAudioElement] = useState<HTMLAudioElement | null>(null);
  const [avatarSpeechText, setAvatarSpeechText] = useState<string>("");

  const headerAvatar = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "128"), [advisorAvatarSrc]);
  const heroAvatar = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "256"), [advisorAvatarSrc]);
  const avatarVariant = useMemo(() => getAdvisorAvatarVariant(advisorId), [advisorId]);
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
    voice: "es-AR-ElenaNeural",
    onPlaybackStart: ({ audioElement, text }) => {
      setAvatarAudioElement(audioElement);
      setAvatarSpeechText(text);
      setAvatarPlaybackId((current) => current + 1);
    },
    onPlaybackEnd: () => {
      setAvatarAudioElement(null);
      setAvatarSpeechText("");
    },
    onPlaybackError: () => {
      setAvatarAudioElement(null);
      setAvatarSpeechText("");
    },
  });
  const voiceSpeaking = speechSynthesis.speaking;

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
    autoStartGuardRef.current = true;
    recorder.startFlow();
  }, [recorder, voiceOpen]);

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
    flowPhase === "countdown"
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
    if (onVoiceSessionSync) {
      onVoiceSessionSync({
        turns: voiceTurns,
        lastSuggestedReply: voiceLastSuggestedReply,
        debug: voiceLastDebug,
      });
      return;
    }
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
  }, [onVoiceExchangeComplete, onVoiceSessionSync, voiceLastDebug, voiceLastSuggestedReply, voiceTurns]);

  const closeVoice = useCallback(
    ({ commit = true }: { commit?: boolean } = {}) => {
      if (commit) commitVoiceSession();
      stopTts();
      recorder.resetRecording();
      setVoiceOpen(false);
      setVoiceTranscriptOpen(false);
      setVoiceSendError(null);
      setVoiceTurns([]);
      setVoiceLastSuggestedReply(null);
      setVoiceLastDebug(null);
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
        const userVoiceText = payload.transcript.trim() || voiceLiveTranscript || "Mensaje de voz";
        if (!payload.audioBlob) {
          recorder.setStatus("error");
          setVoiceSendError("No se pudo capturar audio valido. Intenta nuevamente.");
          return;
        }

        recorder.setStatus("sending");
        setVoiceSendError(null);
        const history = [
          ...messages.map((item) => ({ role: item.role, content: item.text })),
          ...voiceTurns.map((item) => ({ role: item.role, content: item.text })),
        ];
        const result = await postAdvisorVoice({
          advisor_id: advisorId,
          entry_mode: entryMode,
          transcript: userVoiceText,
          audio_blob: payload.audioBlob,
          audio_mime_type: payload.audioBlob.type,
          messages: [...history, { role: "user", content: userVoiceText }],
          case_id: caseId,
          conversation_context: {
            user_name: userName || null,
            relationship_type: "otro",
            extra: { voice_flow: true },
          },
          debug: isDevelopment,
        });

        const advisorReply = result.message.trim() || "No pude responder ahora. Intenta nuevamente.";
        setVoiceTurns((previous) => [
          ...previous,
          { role: "user", text: userVoiceText },
          { role: "advisor", text: advisorReply },
        ]);
        setVoiceLastSuggestedReply(result.suggested_reply);
        setVoiceLastDebug(result.debug ?? null);
        setReadyForNextTurn(false);
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
      isDevelopment,
      messages,
      onDraftChange,
      onSend,
      onVoiceExchangeComplete,
      onVoiceSessionSync,
      recorder,
      speechSynthesis,
      userName,
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
    setVoiceTranscriptOpen(false);
    setVoiceSendError(null);
    setVoiceTurns([]);
    setVoiceLastSuggestedReply(null);
    setVoiceLastDebug(null);
    setFinalizeInFlight(false);
    setReadyForNextTurn(false);
    const desktopDefault =
      typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false;
    setVoiceChatExpanded(desktopDefault);
    setVoiceOpen(true);
  };

  const voiceOverlay =
    typeof document !== "undefined" && voiceOpen
      ? createPortal(
          <div className={styles.vpOverlay}>
            <div
              className={`relative h-[min(88vh,760px)] w-full transition-all duration-300 ${voiceChatExpanded ? "max-w-[780px]" : "max-w-[420px]"}`}
            >
              <button type="button" onClick={() => closeVoice()} className={styles.vpClose} aria-label="Cerrar">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 2 12 12M12 2 2 12" />
                </svg>
              </button>
              <div className={styles.vpCard}>
                <div className="relative flex h-full flex-col lg:flex-row">
                  <section className={`${styles.vpBody} ${voiceChatExpanded ? styles.vpBodySplit : ""} relative flex h-full min-h-0 flex-col items-center px-6 pb-5 pt-4 ${voiceChatExpanded ? "lg:w-[380px] lg:shrink-0" : "lg:w-full"}`}>
                    <header className={`${styles.vpHeader} absolute inset-x-0 top-0`}>
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

                    <div className="relative mt-12 flex h-[256px] w-[256px] items-center justify-center">
                      <span className={`${styles.vpRing} ${styles.vpRing1} ${voiceSpeaking ? styles.vpRingSpeaking : ""} ${(flowPhase === "user_recording" || flowPhase === "user_paused") ? styles.vpRingListening : ""}`} />
                      <span className={`${styles.vpRing} ${styles.vpRing2} ${voiceSpeaking ? styles.vpRingSpeaking : ""} ${(flowPhase === "user_recording" || flowPhase === "user_paused") ? styles.vpRingListening : ""}`} />
                      <span className={`${styles.vpRing} ${styles.vpRing3} ${voiceSpeaking ? styles.vpRingSpeaking : ""} ${(flowPhase === "user_recording" || flowPhase === "user_paused") ? styles.vpRingListening : ""}`} />
                      <button
                        type="button"
                        onClick={() => {
                          if (voiceSpeaking) stopTts();
                        }}
                        disabled={!voiceSpeaking}
                        className={`relative z-[2] rounded-full ${voiceSpeaking ? "cursor-pointer" : "cursor-default"}`}
                        aria-label={voiceSpeaking ? "Detener voz del advisor" : "Avatar del advisor"}
                      >
                        <AdvisorAvatar3D
                          audioElement={avatarAudioElement}
                          speechText={avatarSpeechText}
                          isSpeaking={voiceSpeaking}
                          avatarVariant={avatarVariant}
                          fallbackImageSrc={heroAvatar}
                          label={advisorName}
                          playbackId={avatarPlaybackId}
                          size={168}
                        />
                      </button>
                      {recorder.status === "countdown" ? <span className={styles.vpCountdown}>{recorder.countdown}</span> : null}
                    </div>

                    <div className="mb-3 mt-2 text-center">
                      <p className={styles.vpNameSmall}>{advisorName}</p>
                      {advisorRole ? <p className={styles.vpSub}>{advisorRole}</p> : null}
                      {advisorDescription ? <p className={styles.vpDesc}>{advisorDescription}</p> : null}
                      <p className={`${styles.vpStatus} ${flowPhase === "user_recording" ? styles.vpStatusRecording : ""} ${flowPhase === "user_paused" ? styles.vpStatusPaused : ""} ${flowPhase === "advisor_speaking" ? styles.vpStatusSpeaking : ""} ${flowPhase === "sending" ? styles.vpStatusSending : ""}`}>{statusText}</p>
                    </div>

                    <div className="mb-3 flex h-9 items-center gap-[3px]">
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
                    {voiceSendError || recorder.errorMessage ? <p className={styles.vpError}>{voiceSendError ?? recorder.errorMessage}</p> : null}
                    <div className="mt-auto flex w-full gap-2.5">
                      <button
                        type="button"
                        onClick={() => void handlePrimaryVoiceAction()}
                        disabled={finalizeInFlight || flowPhase === "countdown" || flowPhase === "initializing_media" || flowPhase === "sending"}
                        className={styles.vpPrimaryBtn}
                      >
                        {flowPhase === "advisor_speaking" ? "Detener" : flowPhase === "ready_for_next_turn" || flowPhase === "error" ? "Volver a dictar" : "Enviar dictado"}
                      </button>
                      <button type="button" onClick={() => closeVoice()} className={styles.vpSecondaryBtn}>
                        Cancelar
                      </button>
                    </div>
                  </section>

                  {voiceChatExpanded ? (
                    <aside className={`${styles.vpChatAside} hidden h-full min-h-0 w-[360px] shrink-0 lg:flex lg:flex-col`}>
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
                {isDevelopment && debugPayload ? <details className="text-right"><summary className="cursor-pointer text-[11px]">Debug prompt (solo desarrollo)</summary><pre className="mt-2 max-h-40 overflow-auto rounded-lg p-2 text-left text-[11px]">{JSON.stringify(debugPayload, null, 2)}</pre></details> : null}
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
