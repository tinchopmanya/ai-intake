"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

import {
  advisorPanelShellClass,
  advisorVoiceBodyClass,
  advisorVoiceHeaderClass,
} from "@/components/mvp/advisorUiStyles";
import { Button, Textarea } from "@/components/mvp/ui";
import { postAdvisorVoice } from "@/lib/api/client";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

export type AdvisorChatMessage = {
  id: string;
  role: "user" | "advisor";
  text: string;
};

export type AdvisorChatEntryMode = "advisor_conversation" | "advisor_refine_response";
type VoiceSessionTurn = { role: "user" | "advisor"; text: string };

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

function pickSpanishVoice(voices: SpeechSynthesisVoice[]) {
  const spanish = voices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
  return (
    spanish.find((voice) =>
      /(female|mujer|sofia|paulina|monica|helena|maria|isabela|camila)/i.test(voice.name),
    ) ??
    spanish[0] ??
    voices[0] ??
    null
  );
}

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
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [finalizeInFlight, setFinalizeInFlight] = useState(false);
  const autoStartGuardRef = useRef(false);
  const synthVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const headerAvatar = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "128"), [advisorAvatarSrc]);
  const heroAvatar = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "256"), [advisorAvatarSrc]);
  const preferredVoiceLang = useMemo(
    () =>
      typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es-uy")
        ? "es-UY"
        : "es-ES",
    [],
  );
  const recorder = useVoiceRecorder({ lang: preferredVoiceLang, countdownSeconds: 3 });

  useEffect(() => {
    if (!voiceChatExpanded) return;
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [voiceChatExpanded, voiceTurns, recorder.transcript, recorder.status]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const loadVoices = () => {
      synthVoicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    if (!voiceOpen || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const intervalId = window.setInterval(() => {
      setVoiceSpeaking(window.speechSynthesis.speaking);
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [voiceOpen]);

  useEffect(() => {
    if (!voiceOpen) {
      autoStartGuardRef.current = false;
      return;
    }
    if (autoStartGuardRef.current) return;
    autoStartGuardRef.current = true;
    recorder.startFlow();
  }, [recorder, voiceOpen]);

  const voiceLiveTranscript = recorder.transcript.trim();
  const statusText =
    recorder.status === "countdown"
      ? `Iniciando en ${recorder.countdown} segundo${recorder.countdown === 1 ? "" : "s"}...`
      : recorder.status === "recording"
        ? recorder.transcribing
          ? "Escuchando..."
          : "Escuchando microfono..."
        : recorder.status === "recording_no_transcript"
          ? "Grabando audio, sin transcripcion en vivo."
          : recorder.status === "stopping"
            ? "Finalizando grabacion..."
            : recorder.status === "sending"
              ? "Enviando..."
              : recorder.status === "error"
                ? "No pudimos grabar el audio."
                : "Preparando...";

  const stopTts = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setVoiceSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!text.trim() || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-UY";
    utterance.rate = 0.94;
    utterance.pitch = 1.04;
    const selectedVoice = pickSpanishVoice(synthVoicesRef.current);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onstart = () => setVoiceSpeaking(true);
    utterance.onend = () => setVoiceSpeaking(false);
    utterance.onerror = () => setVoiceSpeaking(false);
    synth.speak(utterance);
  }, []);

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
        speak(advisorReply);
        recorder.resetRecording();
        recorder.setStatus("idle");

        if (!onVoiceSessionSync && !onVoiceExchangeComplete) {
          onDraftChange(userVoiceText);
          if (autoSendOnVoiceComplete) {
            window.setTimeout(() => onSend(), 0);
          }
        }
      } catch {
        recorder.setStatus("error");
        setVoiceSendError("No pudimos enviar la grabacion. Intenta de nuevo.");
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
      speak,
      userName,
      voiceLiveTranscript,
      voiceTurns,
    ],
  );

  const handleFinalize = useCallback(async () => {
    if (finalizeInFlight || recorder.status === "countdown" || recorder.status === "sending") return;
    setFinalizeInFlight(true);
    const payload = await recorder.finalizeRecording();
    await sendVoice(payload);
  }, [finalizeInFlight, recorder, sendVoice]);

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
    const desktopDefault =
      typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false;
    setVoiceChatExpanded(desktopDefault);
    setVoiceOpen(true);
  };

  const voiceOverlay =
    typeof document !== "undefined" && voiceOpen
      ? createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/72 p-3 backdrop-blur-[2px]">
            <div className={`h-[min(88vh,760px)] w-full overflow-hidden transition-all duration-300 ${voiceChatExpanded ? "max-w-[780px]" : "max-w-[420px]"}`}>
              <div className={`h-full overflow-hidden rounded-[20px] border border-[#1c2a3d] bg-[#0d1520] shadow-[0_24px_60px_rgba(0,0,0,0.34)]`}>
                <div className="relative flex h-full flex-col lg:flex-row">
                  <section className={`${advisorVoiceBodyClass} relative flex h-full min-h-0 flex-col items-center px-6 pb-5 pt-8 ${voiceChatExpanded ? "lg:w-[380px] lg:shrink-0 lg:border-r lg:border-[#1f2b3d]" : "lg:w-full"}`}>
                    <header className={`${advisorVoiceHeaderClass} absolute inset-x-0 top-0 flex items-center gap-3 px-5 py-3.5`}>
                      {headerAvatar ? (
                        <Image src={headerAvatar} alt={advisorName} width={48} height={48} priority className="h-12 w-12 rounded-full border-2 border-white/18 object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/18 bg-[#4a9eff] text-[18px] font-bold text-white">{(getInitials(advisorName) || "A")[0]}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px] font-semibold text-white">{advisorName}</p>
                        {advisorRole ? <p className="mt-0.5 text-[11px] text-white/45">{advisorRole}</p> : null}
                      </div>
                      <button type="button" onClick={() => closeVoice()} className="rounded-full border border-white/30 bg-[#0b1424]/96 px-4 py-1.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition hover:bg-[#132038]">Cerrar</button>
                    </header>

                    <button type="button" onClick={() => setVoiceChatExpanded((prev) => !prev)} className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-white/20 bg-[#17253a]/95 px-2 py-6 text-white/80 shadow-[0_8px_18px_rgba(0,0,0,0.32)] transition hover:bg-[#1f3554] lg:inline-flex" aria-label={voiceChatExpanded ? "Contraer chat" : "Expandir chat"}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-4 w-4 transition-transform ${voiceChatExpanded ? "rotate-180" : ""}`}><path d="m7 4 6 6-6 6" /></svg>
                    </button>

                    <div className="relative mt-16 flex h-[256px] w-[256px] items-center justify-center">
                      <span className={`voice-pulse-ring voice-pulse-ring-1 ${voiceSpeaking ? "is-speaking" : ""} ${recorder.status === "recording" ? "is-listening" : ""}`} />
                      <span className={`voice-pulse-ring voice-pulse-ring-2 ${voiceSpeaking ? "is-speaking" : ""} ${recorder.status === "recording" ? "is-listening" : ""}`} />
                      <span className={`voice-pulse-ring voice-pulse-ring-3 ${voiceSpeaking ? "is-speaking" : ""} ${recorder.status === "recording" ? "is-listening" : ""}`} />
                      {heroAvatar ? (
                        <Image src={heroAvatar} alt={advisorName} width={168} height={168} priority className="relative z-[2] h-[168px] w-[168px] rounded-full border-[3px] border-white/12 object-cover" />
                      ) : (
                        <span className="relative z-[2] flex h-[168px] w-[168px] items-center justify-center rounded-full border-[3px] border-white/15 bg-[#4a9eff] text-[52px] font-bold text-white">{(getInitials(advisorName) || "A")[0]}</span>
                      )}
                      {recorder.status === "countdown" ? <span className="absolute bottom-2 right-2 z-[4] flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-[#0d1520] bg-[#2d6be4] text-[22px] font-bold text-white">{recorder.countdown}</span> : null}
                    </div>

                    <div className="mb-3 mt-2 text-center">
                      <p className="text-[14px] font-semibold text-white">{advisorName}</p>
                      {advisorRole ? <p className="text-[11px] text-white/55">{advisorRole}</p> : null}
                      <p className={`mt-1 text-[13px] ${recorder.status === "recording" && recorder.transcribing ? "text-[#ff6b6b]" : recorder.status === "recording" || recorder.status === "recording_no_transcript" ? "text-[#fbbf24]" : recorder.status === "sending" || finalizeInFlight ? "text-[#4a9eff]" : "text-white/70"}`}>{statusText}</p>
                    </div>

                    <div className="mb-3 flex h-9 items-center gap-[3px]">{Array.from({ length: 12 }).map((_, index) => <span key={`wave-${index}`} className={`voice-wave-bar ${recorder.status === "recording" || voiceSpeaking ? "is-active" : "is-paused"}`} style={{ animationDelay: `${index * 0.1}s` }} />)}</div>
                    <button type="button" onClick={() => setVoiceTranscriptOpen((prev) => !prev)} className="mb-1 flex items-center gap-2 bg-transparent text-[12px] text-white/40 transition-colors hover:text-white/65"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-3 w-3 transition-transform ${voiceTranscriptOpen ? "rotate-90" : ""}`}><path d="M4 2l4 4-4 4" /></svg>lo que se escucho</button>
                    <div className={`w-full overflow-hidden rounded-[10px] bg-white/6 px-3.5 text-[12px] leading-5 text-white/60 transition-all duration-300 ${voiceTranscriptOpen ? "mb-3 max-h-[44px] py-2" : "mb-0 max-h-0 py-0"}`}>El transcript en vivo se muestra en el chat lateral.</div>
                    {voiceSendError || recorder.errorMessage ? <p className="mb-2 w-full text-center text-[12px] text-[#fca5a5]">{voiceSendError ?? recorder.errorMessage}</p> : null}
                    <div className="mt-auto flex w-full gap-2.5">
                      <button type="button" onClick={() => void handleFinalize()} disabled={finalizeInFlight || recorder.status === "countdown" || recorder.status === "sending"} className="flex-1 rounded-xl border-0 bg-[#2d6be4] px-4 py-[11px] text-[14px] font-semibold text-white transition-all hover:bg-[#1d5bcd] disabled:cursor-not-allowed disabled:opacity-45">Finalizar grabacion</button>
                      <button type="button" onClick={() => closeVoice()} className="rounded-xl border border-white/12 bg-white/[0.06] px-4 py-[11px] text-[13px] text-white/70 transition-all hover:bg-white/[0.1] hover:text-white">Cancelar</button>
                    </div>
                  </section>

                  {voiceChatExpanded ? (
                    <aside className="hidden h-full min-h-0 w-[360px] shrink-0 bg-[#0f1826] lg:flex lg:flex-col">
                      <div className="shrink-0 border-b border-[#1f2b3d] px-4 py-3">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">Conversacion</p>
                      </div>
                      <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#0f1826] px-4 py-3">
                        {voiceTurns.map((turn, index) => (
                          <div key={`turn-${index}-${turn.role}`} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={turn.role === "user" ? "max-w-[76%]" : "max-w-[82%]"}>
                              <p className={`mb-1 text-[10px] font-bold tracking-[0.08em] ${turn.role === "user" ? "text-right text-[#2d8a50]" : "text-[#2d6be4]"}`}>{turn.role === "user" ? "TU VOZ" : advisorName.toUpperCase()}</p>
                              <div className={`whitespace-pre-wrap break-words px-[12px] py-[9px] text-[13px] leading-[1.55] ${turn.role === "user" ? "rounded-[16px_16px_4px_16px] bg-[#d4edda] text-[#1a4a2a]" : "rounded-[4px_16px_16px_16px] border border-[#e8ecf2] bg-white text-[#2c3e50]"}`}>{turn.text}</div>
                            </div>
                          </div>
                        ))}

                        {(recorder.status === "recording" ||
                          recorder.status === "recording_no_transcript" ||
                          recorder.status === "stopping" ||
                          recorder.status === "sending" ||
                          finalizeInFlight) &&
                        voiceLiveTranscript ? (
                          <div className="flex justify-end">
                            <div className="max-w-[76%]">
                              <p className="mb-1 text-right text-[10px] font-bold tracking-[0.08em] text-[#a16207]">TU VOZ</p>
                              <div className="rounded-[16px_16px_4px_16px] border border-amber-300/60 bg-amber-100 px-[12px] py-[9px] text-[13px] leading-[1.55] text-amber-950">
                                {voiceLiveTranscript}
                                {recorder.status === "recording" && recorder.transcribing ? (
                                  <span className="voice-live-caret ml-0.5 inline-block h-[15px] w-[1px] bg-amber-900 align-[-2px]" />
                                ) : null}
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]">
        <div className={`relative flex h-[min(92vh,760px)] w-full max-w-[560px] flex-col overflow-hidden ${advisorPanelShellClass}`}>
          <header className="flex items-center gap-3 bg-[#1e2a3a] px-5 py-4">
            {headerAvatar ? <Image src={headerAvatar} alt={advisorName} width={48} height={48} className="h-12 w-12 rounded-full border-2 border-white/20 object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-[#4a9eff] text-[18px] font-bold text-white">{(getInitials(advisorName) || "A")[0]}</span>}
            <div className="min-w-0 flex-1"><p className="truncate text-[17px] font-semibold text-white">{advisorName}</p>{advisorRole ? <p className="mt-0.5 text-[12px] text-white/55">{advisorRole}</p> : null}{advisorDescription ? <p className="mt-1 line-clamp-2 text-[11px] text-white/70">{advisorDescription}</p> : null}</div>
            <button type="button" onClick={() => { if (voiceOpen) closeVoice(); onClose(); }} className="rounded-full border border-white/30 bg-[#0b1424]/96 px-4 py-1.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition hover:bg-[#132038]">Cerrar</button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col bg-[#f4f6fa]">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-5">
              {messages.length === 0 ? <div className="max-w-[80%]"><p className="mb-1 text-[10px] font-bold tracking-[0.08em] text-[#2d6be4]">{advisorName.toUpperCase()}</p><div className="rounded-[4px_16px_16px_16px] border border-[#e8ecf2] bg-white px-4 py-3 text-[14px] leading-[1.55] text-[#2c3e50]">{helperText}</div></div> : <div className="flex flex-col gap-3">{messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={message.role === "user" ? "max-w-[70%]" : "max-w-[80%]"}><p className={`mb-1 text-[10px] font-bold tracking-[0.08em] ${message.role === "user" ? "text-right text-[#2d8a50]" : "text-[#2d6be4]"}`}>{message.role === "user" ? "TU" : advisorName.toUpperCase()}</p><div className={`whitespace-pre-wrap break-words px-[14px] py-[10px] text-[14px] leading-[1.55] ${message.role === "user" ? "rounded-[16px_16px_4px_16px] bg-[#d4edda] text-[#1a4a2a]" : "rounded-[4px_16px_16px_16px] border border-[#e8ecf2] bg-white text-[#2c3e50]"}`}>{message.text}</div></div></div>)}</div>}
            </div>

            <footer className="border-t border-[#e8ecf2] bg-white px-4 py-3">
              <div className="mb-2 flex items-end gap-2">
                <Textarea id="advisor-chat-draft" value={draft} onChange={(event) => onDraftChange(event.target.value)} rows={1} spellCheck={false} placeholder={inputPlaceholder} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!sending && draft.trim()) onSend(); } }} className="min-h-[42px] max-h-[120px] flex-1 rounded-xl border-[1.5px] border-[#dde3ef] px-[14px] py-[10px] text-[14px] text-[#2c3e50] placeholder:text-[#aab3c5] focus:border-[#4a9eff] focus:ring-0" />
                <button type="button" onClick={openVoice} className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#dde3ef] bg-[#f4f6fa] text-[#6b7a99] transition-all hover:border-[#4a9eff] hover:bg-[#e8ecf2]" aria-label="Hablar con el advisor"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 19v3" /><path d="M8 22h8" /></svg></button>
                <Button type="button" variant="primary" disabled={sending || !draft.trim()} onClick={onSend} className="h-[42px] rounded-xl border-0 bg-[#2d6be4] px-[18px] text-[14px] font-semibold text-white hover:bg-[#1d5bcd]">{sending ? "Enviando..." : "Enviar"}</Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="secondary" onClick={onUseResponse} className="rounded-[10px] border-[1.5px] border-[#dde3ef] bg-transparent px-[14px] py-[7px] text-[13px] text-[#6b7a99] hover:border-[#4a9eff] hover:text-[#2d6be4]">Usar esta respuesta</Button>
                {isDevelopment && debugPayload ? <details className="text-right"><summary className="cursor-pointer text-[11px] text-[#aab3c5]">Debug prompt (solo desarrollo)</summary><pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-[#e8ecf2] bg-[#f8fafc] p-2 text-left text-[11px] text-[#334155]">{JSON.stringify(debugPayload, null, 2)}</pre></details> : null}
              </div>
            </footer>
          </div>
        </div>
      </div>
      {voiceOverlay}
    </>
  );
}
