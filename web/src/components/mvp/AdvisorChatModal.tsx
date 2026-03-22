"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
};

function getInitials(value: string): string {
  return value
    .split(" ")
    .filter((part) => part.trim().length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function resolveAvatarVariant(src: string | null | undefined, variant: "128" | "256"): string | null {
  if (!src) return null;
  if (variant === "128") {
    if (src.includes("_128")) return src;
    if (src.includes("_64")) return src.replace("_64", "_128");
    if (src.includes("_256")) return src.replace("_256", "_128");
    return src;
  }
  if (src.includes("_256")) return src;
  if (src.includes("_128")) return src.replace("_128", "_256");
  if (src.includes("_64")) return src.replace("_64", "_256");
  return src;
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
}: AdvisorChatModalProps) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceTranscriptOpen, setVoiceTranscriptOpen] = useState(false);
  const [voiceSendError, setVoiceSendError] = useState<string | null>(null);
  const voiceAutoStartGuardRef = useRef(false);

  const headerAvatarSrc = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "128"), [advisorAvatarSrc]);
  const voiceHeroAvatarSrc = useMemo(() => resolveAvatarVariant(advisorAvatarSrc, "256"), [advisorAvatarSrc]);

  const preferredVoiceLang = useMemo(() => {
    if (typeof navigator === "undefined") return "es-UY";
    const browserLanguages = [navigator.language, ...(navigator.languages ?? [])]
      .filter((item): item is string => Boolean(item))
      .map((item) => item.toLowerCase());
    return browserLanguages.some((item) => item.startsWith("es-uy")) ? "es-UY" : "es-ES";
  }, []);

  const recorder = useVoiceRecorder({
    lang: preferredVoiceLang,
    countdownSeconds: 3,
    autoStopMs: 18000,
  });
  const startVoiceFlowRef = useRef(recorder.startFlow);
  useEffect(() => {
    startVoiceFlowRef.current = recorder.startFlow;
  }, [recorder.startFlow]);

  const voiceUserText = recorder.transcript || "Mensaje de voz";

  const statusText = useMemo(() => {
    if (recorder.status === "countdown") {
      if (recorder.countdown > 1) return `Iniciando en ${recorder.countdown} segundos...`;
      return `Iniciando en ${recorder.countdown} segundo...`;
    }
    if (recorder.status === "recording") return "Escuchando...";
    if (recorder.status === "sending") return "Enviando...";
    if (recorder.status === "error") return "No pudimos grabar el audio.";
    if (recorder.audioBlob) return "Grabacion lista para enviar";
    return "Preparando...";
  }, [recorder.audioBlob, recorder.countdown, recorder.status]);

  const headerStatusText = useMemo(() => {
    if (recorder.status === "countdown") return "Preparando...";
    if (recorder.status === "recording") return "Escuchando tu mensaje";
    if (recorder.status === "sending") return "Procesando tu mensaje";
    if (recorder.audioBlob) return "Listo para enviar";
    if (recorder.status === "error") return "Error";
    return "Preparando...";
  }, [recorder.audioBlob, recorder.status]);

  function closeVoiceModal() {
    voiceAutoStartGuardRef.current = false;
    recorder.resetRecording();
    setVoiceTranscriptOpen(false);
    setVoiceSendError(null);
    setVoiceModalOpen(false);
  }

  function openVoiceModal() {
    setVoiceTranscriptOpen(false);
    setVoiceSendError(null);
    setVoiceModalOpen(true);
  }

  useEffect(() => {
    if (!voiceModalOpen) {
      voiceAutoStartGuardRef.current = false;
      return;
    }
    if (voiceAutoStartGuardRef.current) return;
    voiceAutoStartGuardRef.current = true;
    startVoiceFlowRef.current();
  }, [voiceModalOpen]);

  async function handleSendVoice() {
    if (!advisorId || !recorder.audioBlob || recorder.status === "sending") return;
    setVoiceSendError(null);
    recorder.setStatus("sending");

    try {
      const baseMessages = messages.map((item) => ({
        role: item.role,
        content: item.text,
      }));
      const userVoiceMessage = {
        role: "user" as const,
        content: voiceUserText,
      };
      const payloadMessages =
        baseMessages.length > 0 &&
        baseMessages[baseMessages.length - 1]?.role === "user" &&
        baseMessages[baseMessages.length - 1]?.content.trim() === userVoiceMessage.content.trim()
          ? baseMessages
          : [...baseMessages, userVoiceMessage];

      const result = await postAdvisorVoice({
        advisor_id: advisorId,
        entry_mode: entryMode,
        transcript: voiceUserText,
        audio_blob: recorder.audioBlob,
        audio_mime_type: recorder.audioBlob.type,
        messages: payloadMessages,
        case_id: caseId,
        conversation_context: {
          user_name: userName || null,
          relationship_type: "otro",
          extra: {
            voice_flow: true,
            transcript_supported: recorder.speechSupported,
          },
        },
        debug: isDevelopment,
      });

      const advisorText = result.message.trim() || "No pude responder ahora. Intenta nuevamente.";
      if (onVoiceExchangeComplete) {
        onVoiceExchangeComplete({
          userText: voiceUserText,
          advisorText,
          suggestedReply: result.suggested_reply,
          debug: result.debug ?? null,
        });
      } else {
        onDraftChange(voiceUserText);
        if (autoSendOnVoiceComplete) {
          window.setTimeout(() => onSend(), 0);
        }
      }
      closeVoiceModal();
    } catch {
      recorder.setStatus("error");
      setVoiceSendError("No pudimos enviar la grabacion. Intenta de nuevo.");
    }
  }

  const inputPlaceholder =
    entryMode === "advisor_conversation" ? "Escribi tu mensaje..." : "Escribi como queres ajustarlo...";

  const helperFallback =
    entryMode === "advisor_conversation"
      ? `Como estas hoy${userName ? `, ${userName}` : ""}? En que te puedo ayudar?`
      : "Contame que queres ajustar y lo mejoramos juntos.";
  const resolvedHelperCopy = helperCopy || helperFallback;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending && draft.trim()) {
        onSend();
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]">
      <div className={`relative flex h-[min(92vh,760px)] w-full max-w-[560px] flex-col overflow-hidden ${advisorPanelShellClass}`}>
        <header className="flex items-center gap-3 bg-[#1e2a3a] px-5 py-4">
          {headerAvatarSrc ? (
            <Image
              src={headerAvatarSrc}
              alt={advisorName}
              width={48}
              height={48}
              className="h-12 w-12 rounded-full border-2 border-white/20 object-cover"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-[#4a9eff] text-[18px] font-bold text-white">
              {(getInitials(advisorName) || "A").slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-white">{advisorName}</p>
            {advisorRole ? <p className="mt-0.5 text-[12px] text-white/55">{advisorRole}</p> : null}
            {advisorDescription ? <p className="mt-1 line-clamp-2 text-[11px] text-white/70">{advisorDescription}</p> : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="shrink-0 rounded-[10px] border-0 bg-white/10 px-4 py-[7px] text-[13px] text-white hover:bg-white/20"
          >
            Cerrar
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-[#f4f6fa]">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-5">
            {messages.length === 0 ? (
              <div className="max-w-[80%]">
                <p className="mb-1 text-[10px] font-bold tracking-[0.08em] text-[#2d6be4]">{advisorName.toUpperCase()}</p>
                <div className="rounded-[4px_16px_16px_16px] border border-[#e8ecf2] bg-white px-4 py-3 text-[14px] leading-[1.55] text-[#2c3e50]">
                  {resolvedHelperCopy}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div className={isUser ? "max-w-[70%]" : "max-w-[80%]"}>
                        <p
                          className={`mb-1 text-[10px] font-bold tracking-[0.08em] ${
                            isUser ? "text-right text-[#2d8a50]" : "text-[#2d6be4]"
                          }`}
                        >
                          {isUser ? "TU" : advisorName.toUpperCase()}
                        </p>
                        <div
                          className={`whitespace-pre-wrap break-words px-[14px] py-[10px] text-[14px] leading-[1.55] ${
                            isUser
                              ? "rounded-[16px_16px_4px_16px] bg-[#d4edda] text-[#1a4a2a]"
                              : "rounded-[4px_16px_16px_16px] border border-[#e8ecf2] bg-white text-[#2c3e50]"
                          }`}
                        >
                          {message.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <footer className="border-t border-[#e8ecf2] bg-white px-4 py-3">
            <div className="mb-2 flex items-end gap-2">
              <Textarea
                id="advisor-chat-draft"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                rows={1}
                spellCheck={false}
                placeholder={inputPlaceholder}
                onKeyDown={handleKeyDown}
                className="min-h-[42px] max-h-[120px] flex-1 rounded-xl border-[1.5px] border-[#dde3ef] px-[14px] py-[10px] text-[14px] text-[#2c3e50] placeholder:text-[#aab3c5] focus:border-[#4a9eff] focus:ring-0"
              />
              <button
                type="button"
                onClick={openVoiceModal}
                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#dde3ef] bg-[#f4f6fa] text-[#6b7a99] transition-all hover:border-[#4a9eff] hover:bg-[#e8ecf2]"
                aria-label="Hablar con el advisor"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-[18px] w-[18px]"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <path d="M12 19v3" />
                  <path d="M8 22h8" />
                </svg>
              </button>
              <Button
                type="button"
                variant="primary"
                disabled={sending || !draft.trim()}
                onClick={onSend}
                className="h-[42px] rounded-xl border-0 bg-[#2d6be4] px-[18px] text-[14px] font-semibold text-white hover:bg-[#1d5bcd]"
              >
                {sending ? "Enviando..." : "Enviar"}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onUseResponse}
                className="rounded-[10px] border-[1.5px] border-[#dde3ef] bg-transparent px-[14px] py-[7px] text-[13px] text-[#6b7a99] hover:border-[#4a9eff] hover:text-[#2d6be4]"
              >
                Usar esta respuesta
              </Button>
              {isDevelopment && debugPayload ? (
                <details className="text-right">
                  <summary className="cursor-pointer text-[11px] text-[#aab3c5]">Debug prompt (solo desarrollo)</summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-[#e8ecf2] bg-[#f8fafc] p-2 text-left text-[11px] text-[#334155]">
                    {JSON.stringify(debugPayload, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          </footer>
        </div>

        {voiceModalOpen ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-[2px]">
            <div className={`w-full max-w-[560px] overflow-hidden ${advisorPanelShellClass}`}>
              <header className={`${advisorVoiceHeaderClass} flex items-center gap-3 px-5 py-3.5`}>
                {headerAvatarSrc ? (
                  <Image
                    src={headerAvatarSrc}
                    alt={advisorName}
                    width={48}
                    height={48}
                    priority={voiceModalOpen}
                    className="h-12 w-12 rounded-full border-2 border-white/18 object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/18 bg-[#4a9eff] text-[18px] font-bold text-white">
                    {(getInitials(advisorName) || "A").slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-white">{advisorName}</p>
                  {advisorRole ? <p className="mt-0.5 text-[11px] text-white/45">{advisorRole}</p> : null}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#4a9eff]">
                    <span className={`h-1.5 w-1.5 rounded-full ${recorder.status === "recording" ? "animate-pulse bg-[#ff6b6b]" : "bg-[#4a9eff]"}`} />
                    {headerStatusText}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeVoiceModal}
                  className="rounded-[10px] border-0 bg-white/10 px-4 py-[7px] text-[13px] text-white hover:bg-white/20"
                >
                  Cerrar
                </Button>
              </header>

              <div className={`${advisorVoiceBodyClass} flex flex-col items-center px-6 pb-6 pt-8`}>
                <div className="relative mb-5 flex h-[256px] w-[256px] items-center justify-center">
                  <span className={`voice-pulse-ring voice-pulse-ring-1 ${recorder.status === "recording" ? "is-listening" : ""}`} aria-hidden />
                  <span className={`voice-pulse-ring voice-pulse-ring-2 ${recorder.status === "recording" ? "is-listening" : ""}`} aria-hidden />
                  <span className={`voice-pulse-ring voice-pulse-ring-3 ${recorder.status === "recording" ? "is-listening" : ""}`} aria-hidden />
                  {voiceHeroAvatarSrc ? (
                    <Image
                      src={voiceHeroAvatarSrc}
                      alt={advisorName}
                      width={168}
                      height={168}
                      priority={voiceModalOpen}
                      className="relative z-[2] h-[168px] w-[168px] rounded-full border-[3px] border-white/12 object-cover"
                    />
                  ) : (
                    <span className="relative z-[2] flex h-[168px] w-[168px] items-center justify-center rounded-full border-[3px] border-white/15 bg-[#4a9eff] text-[52px] font-bold text-white">
                      {(getInitials(advisorName) || "A").slice(0, 1)}
                    </span>
                  )}
                  {recorder.status === "countdown" ? (
                    <span className="absolute bottom-2 right-2 z-[4] flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-[#0d1520] bg-[#2d6be4] text-[22px] font-bold text-white">
                      {recorder.countdown}
                    </span>
                  ) : null}
                </div>

                <p
                  className={`mb-5 text-center text-[15px] font-medium ${
                    recorder.status === "recording"
                      ? "text-[#ff6b6b]"
                      : recorder.status === "sending"
                        ? "text-[#4a9eff]"
                        : recorder.status === "error"
                          ? "text-[#fca5a5]"
                          : "text-white/70"
                  }`}
                >
                  {statusText}
                </p>

                <div className="mb-5 flex h-9 items-center gap-[3px]">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <span
                      key={`voice-wave-${index}`}
                      className={`voice-wave-bar ${recorder.status === "recording" ? "is-active" : "is-paused"}`}
                      style={{ animationDelay: `${index * 0.1}s` }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setVoiceTranscriptOpen((current) => !current)}
                  className={`mb-1 flex items-center gap-2 bg-transparent text-[12px] text-white/35 transition-colors hover:text-white/60 ${
                    voiceTranscriptOpen ? "is-open" : ""
                  }`}
                >
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className={`h-3 w-3 transition-transform ${voiceTranscriptOpen ? "rotate-90" : ""}`}
                  >
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                  lo que se escucho
                </button>

                <div
                  className={`w-full overflow-hidden rounded-[10px] bg-white/5 px-3.5 text-[12px] leading-6 text-white/55 transition-all duration-300 ${
                    voiceTranscriptOpen ? "mb-3 max-h-[120px] py-2.5" : "mb-0 max-h-0 py-0"
                  }`}
                >
                  {recorder.transcript || "Aun no hay texto transcripto."}
                </div>

                {recorder.errorMessage || voiceSendError ? (
                  <p className="mb-2 w-full text-center text-[12px] text-[#fca5a5]">
                    {voiceSendError ?? recorder.errorMessage}
                  </p>
                ) : null}

                <div className="mt-1 flex w-full flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      void recorder.requestMicProbe().then((ok) => {
                        if (ok) recorder.startFlow();
                      });
                    }}
                    className="min-w-[110px] flex-1 rounded-xl border border-white/12 bg-white/[0.07] px-3 py-[11px] text-[13px] text-white/65 transition-all hover:bg-white/12 hover:text-white"
                  >
                    Probar mic
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendVoice()}
                    disabled={!recorder.canSend || recorder.status === "sending"}
                    className="min-w-[180px] flex-[2] rounded-xl border-0 bg-[#2d6be4] px-5 py-[11px] text-[14px] font-semibold text-white transition-all hover:bg-[#1d5bcd] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Enviar grabacion
                  </button>
                  <button
                    type="button"
                    onClick={closeVoiceModal}
                    className="min-w-[110px] flex-1 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-[11px] text-[13px] text-white/35 transition-all hover:bg-white/8 hover:text-white/65"
                  >
                    Cancelar
                  </button>
                </div>

                {isDevelopment ? (
                  <details className="mt-2 w-full">
                    <summary className="cursor-pointer text-[11px] text-white/25">Debug voz (solo desarrollo)</summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-white/8 bg-white/5 p-2 text-[11px] text-white/60">
                      {JSON.stringify(
                        {
                          status: recorder.status,
                          countdown: recorder.countdown,
                          transcriptLength: recorder.transcript.length,
                          audioSize: recorder.audioBlob?.size ?? 0,
                          audioType: recorder.audioBlob?.type ?? null,
                          speechSupported: recorder.speechSupported,
                          microphoneStatus: recorder.microphoneStatus,
                          micSupported: recorder.micSupported,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
