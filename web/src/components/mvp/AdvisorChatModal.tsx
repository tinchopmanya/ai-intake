"use client";

import { useEffect } from "react";
import Image from "next/image";

import { Button, Textarea } from "@/components/mvp/ui";
import { VoiceMicButton } from "@/components/mvp/VoiceControls";
import {
  getMicrophoneStatusMessage,
  getSpeechToTextErrorMessage,
  useSpeechToText,
} from "@/hooks/useSpeechToText";

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
  userName?: string;
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
};

export function AdvisorChatModal({
  isOpen,
  advisorName,
  advisorRole,
  advisorDescription,
  userName = "",
  advisorAvatarSrc,
  messages,
  draft,
  sending,
  entryMode,
  helperCopy,
  debugPayload,
  autoSendOnVoiceComplete = false,
  onDraftChange,
  onSend,
  onUseResponse,
  onClose,
}: AdvisorChatModalProps) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const voice = useSpeechToText({
    lang: "es-ES",
    continuous: true,
    interimResults: true,
    silenceTimeoutMs: 3000,
  });
  const microphoneStatusMessage = getMicrophoneStatusMessage(
    voice.microphoneStatus,
    voice.speechSupported,
  );
  const defaultHelperCopy =
    entryMode === "advisor_conversation"
      ? `Como estas hoy${userName ? `, ${userName}` : ""}? Estoy aqui para escucharte y ayudarte a ordenar esto.`
      : `${userName || "Cuentame"}, que te parecio mi sugerencia? Si quieres, la ajustamos juntos.`;
  const resolvedHelperCopy = helperCopy || defaultHelperCopy;
  const inputPlaceholder =
    entryMode === "advisor_conversation"
      ? "Escribe o habla para que te ayude."
      : "Que quieres cambiar de mi sugerencia?";

  useEffect(() => {
    if (!isOpen || !voice.transcript.trim()) return;
    const merged = draft.trim() ? `${draft.trim()}\n${voice.transcript.trim()}` : voice.transcript.trim();
    onDraftChange(merged);
    const wrapper = document.getElementById("advisor-chat-draft-wrap");
    if (wrapper) {
      wrapper.style.transition = "box-shadow 180ms ease, background-color 180ms ease";
      wrapper.style.boxShadow = "0 0 0 2px rgba(191, 219, 254, 1)";
      wrapper.style.backgroundColor = "#f8fafc";
      window.setTimeout(() => {
        wrapper.style.boxShadow = "";
        wrapper.style.backgroundColor = "";
      }, 850);
    }
    window.setTimeout(() => {
      const input = document.getElementById("advisor-chat-draft") as HTMLTextAreaElement | null;
      input?.focus();
    }, 30);
    if (
      autoSendOnVoiceComplete &&
      entryMode === "advisor_conversation" &&
      merged.trim().length >= 4
    ) {
      window.setTimeout(() => {
        onSend();
      }, 80);
    }
    voice.resetTranscript();
  }, [autoSendOnVoiceComplete, draft, entryMode, isOpen, onDraftChange, onSend, voice]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3">
      <div className="relative flex h-[min(90vh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_20px_40px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            {advisorAvatarSrc ? (
              <Image
                src={advisorAvatarSrc}
                alt={advisorName}
                width={44}
                height={44}
                className="h-11 w-11 rounded-full border border-[#e5e5e5] object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#111] text-[12px] font-semibold text-white">
                {advisorName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold text-[#0F172A]">{advisorName}</p>
              {advisorRole ? <p className="text-[12px] font-medium text-[#475569]">{advisorRole}</p> : null}
              {advisorDescription ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] text-[#64748b]">{advisorDescription}</p>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="border-[#CBD5E1] bg-white px-3 py-1.5 text-sm text-[#334155]"
          >
            Cerrar
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fafafa] px-4 py-4">
          {messages.length === 0 ? (
            <div className="rounded-xl border border-[#e5e7eb] bg-white px-3 py-3 text-[14px] text-[#475569]">
              {resolvedHelperCopy}
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message.id}
                    className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl border px-3 py-2 text-sm leading-6 ${
                      isUser
                        ? "ml-auto border-[#bcd4ff] bg-[#eaf3ff] text-[#1e3a8a]"
                        : "mr-auto border-[#e2e8f0] bg-white text-[#0f172a]"
                    }`}
                  >
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                      {isUser ? "Tu" : advisorName}
                    </p>
                    <p>{message.text}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="space-y-3 border-t border-[#E2E8F0] bg-white px-4 py-3">
          <p className="text-[13px] text-[#666]">{resolvedHelperCopy}</p>

          <div id="advisor-chat-draft-wrap" className="rounded-xl transition-all duration-200">
            <Textarea
              id="advisor-chat-draft"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={inputPlaceholder}
              className="border-[#E2E8F0] bg-white text-[#0F172A]"
            />
          </div>

          <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <VoiceMicButton
                listening={voice.listening}
                disabled={voice.microphoneStatus === "requesting"}
                onClick={() => {
                  if (voice.listening) {
                    voice.stopListening();
                  } else {
                    voice.startListening();
                  }
                }}
                idleLabel="Hablar con el advisor"
                listeningLabel="Escuchando..."
              />
              {voice.phase === "transcript_ready" ? (
                <span className="inline-flex h-8 items-center rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 text-[12px] text-[#166534]">
                  Transcript listo para editar
                </span>
              ) : null}
            </div>

            {microphoneStatusMessage ? <p className="mt-2 text-[12px] text-[#666]">{microphoneStatusMessage}</p> : null}
            {voice.error ? <p className="mt-2 text-[12px] text-[#92400e]">{getSpeechToTextErrorMessage(voice.error)}</p> : null}
            {!microphoneStatusMessage && voice.speechSupported ? (
              <p className="mt-2 text-[12px] text-[#666]">
                Habla con naturalidad. El texto se inserta en el campo y puedes editarlo antes de enviar.
              </p>
            ) : null}

            {isDevelopment ? (
              <button
                type="button"
                onClick={() => {
                  void voice.requestMicrophonePermission();
                }}
                disabled={voice.microphoneStatus === "requesting"}
                className="mt-2 inline-flex h-8 items-center rounded-full border border-[#d7d7d7] bg-white px-3 text-[12px] text-[#334155] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Probar microfono
              </button>
            ) : null}
          </div>

          {isDevelopment && debugPayload ? (
            <details className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
              <summary className="cursor-pointer text-[12px] font-medium text-[#334155]">
                Debug prompt advisor (solo desarrollo)
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[#334155]">
                {JSON.stringify(debugPayload, null, 2)}
              </pre>
            </details>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onUseResponse}
              className="border-[#CBD5E1] bg-white text-[#334155]"
            >
              Usar esta respuesta
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={sending || !draft.trim()}
              onClick={onSend}
              className="bg-[#1D4ED8] hover:bg-[#1E40AF]"
            >
              {sending
                ? "Enviando..."
                : entryMode === "advisor_conversation"
                  ? "Enviar al advisor"
                  : "Refinar sugerencia"}
            </Button>
          </div>
        </footer>

        {voice.listening ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center bg-slate-900/10 p-6">
            <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-[#f2d2d8] bg-white p-4 shadow-[0_16px_30px_rgba(15,23,42,0.16)]">
              <div className="flex items-center gap-3">
                {advisorAvatarSrc ? (
                  <Image
                    src={advisorAvatarSrc}
                    alt={advisorName}
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-full border border-[#e5e5e5] object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111] text-[11px] font-semibold text-white">
                    {advisorName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#7f1d1d]">{advisorName}</p>
                  <p className="inline-flex items-center gap-1 text-[12px] text-[#b42318]">
                    <span className="relative h-2 w-2 rounded-full bg-[#ef4444]">
                      <span className="absolute inset-0 rounded-full bg-[#ef4444] opacity-70 animate-ping" />
                    </span>
                    Escuchando...
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={voice.stopListening}
                  className="h-8 rounded-full border-[#f2d2d8] bg-white px-3 text-[12px] text-[#7f1d1d] hover:bg-[#fff7f8]"
                >
                  Terminar
                </Button>
              </div>
              <p className="mt-3 min-h-10 whitespace-pre-wrap break-words rounded-xl border border-[#f8d7dd] bg-[#fff7f8] px-3 py-2 text-[12px] text-[#7f1d1d]">
                {voice.transcript.trim() || "Estoy escuchando. Habla cuando quieras."}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
