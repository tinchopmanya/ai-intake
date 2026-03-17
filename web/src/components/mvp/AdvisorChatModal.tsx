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
  advisorAvatarSrc?: string | null;
  messages: AdvisorChatMessage[];
  draft: string;
  sending: boolean;
  entryMode: AdvisorChatEntryMode;
  helperCopy?: string;
  debugPayload?: Record<string, unknown> | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onUseResponse: () => void;
  onClose: () => void;
};

export function AdvisorChatModal({
  isOpen,
  advisorName,
  advisorAvatarSrc,
  messages,
  draft,
  sending,
  entryMode,
  helperCopy,
  debugPayload,
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
      ? "Como estas hoy? En que te puedo ayudar?"
      : "Que te parecio mi sugerencia? Quieres darme mas contexto para ajustarla?";
  const resolvedHelperCopy = helperCopy || defaultHelperCopy;

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
    voice.resetTranscript();
  }, [draft, isOpen, onDraftChange, voice]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3">
      <div className="flex h-[min(88vh,740px)] w-full max-w-2xl flex-col rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_20px_40px_rgba(15,23,42,0.2)]">
        <header className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
          <h3 className="text-base font-semibold text-[#0F172A]">Chat con {advisorName}</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="border-[#CBD5E1] bg-white px-3 py-1.5 text-sm text-[#334155]"
          >
            Cerrar
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#fafafa] p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-[#666]">{resolvedHelperCopy}</p>
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6 ${
                    isUser
                      ? "ml-auto bg-[#DBEAFE] text-[#1E3A8A]"
                      : "mr-auto border border-[#E2E8F0] bg-white text-[#0F172A]"
                  }`}
                >
                  {message.text}
                </div>
              );
            })
          )}
        </div>

        <footer className="space-y-3 border-t border-[#E2E8F0] bg-white px-4 py-3">
          {messages.length > 0 ? <p className="text-[13px] text-[#666]">{resolvedHelperCopy}</p> : null}
          <div id="advisor-chat-draft-wrap" className="rounded-xl transition-all duration-200">
            <Textarea
              id="advisor-chat-draft"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="Ej: manten el limite pero mas breve y neutral."
              className="border-[#E2E8F0] bg-white text-[#0F172A]"
            />
          </div>

          <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3">
            <div className="space-y-2">
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
                {voice.listening ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={voice.stopListening}
                    className="h-9 rounded-full border-[#f2d2d8] bg-white px-4 text-[13px] text-[#7f1d1d] hover:bg-[#fff7f8]"
                  >
                    Terminar grabacion
                  </Button>
                ) : null}
              </div>
              {voice.listening ? (
                <div className="rounded-xl border border-[#f2d2d8] bg-[#fff7f8] p-3">
                  <div className="flex items-center gap-2">
                    {advisorAvatarSrc ? (
                      <Image
                        src={advisorAvatarSrc}
                        alt={advisorName}
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-full border border-[#e5e5e5] object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111] text-[11px] font-semibold text-white">
                        {advisorName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#7f1d1d]">{advisorName}</p>
                      <p className="inline-flex items-center gap-1 text-[12px] text-[#b42318]">
                        <span className="relative h-2 w-2 rounded-full bg-[#ef4444]">
                          <span className="absolute inset-0 rounded-full bg-[#ef4444] opacity-70 animate-ping" />
                        </span>
                        Escuchando...
                      </p>
                    </div>
                  </div>
                  {voice.transcript.trim() ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-[12px] text-[#7f1d1d]">
                      {voice.transcript}
                    </p>
                  ) : (
                    <p className="mt-2 text-[12px] text-[#7f1d1d]">
                      Puedes hablar libremente. Luego puedes editar antes de enviar.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            {microphoneStatusMessage ? <p className="mt-2 text-[12px] text-[#666]">{microphoneStatusMessage}</p> : null}
            {!microphoneStatusMessage && voice.speechSupported ? (
              <p className="mt-2 text-[12px] text-[#666]">
                Puedes desahogarte o pedir ayuda. El texto se inserta editable y no se envia automaticamente.
              </p>
            ) : null}

            {voice.error ? <p className="mt-2 text-[12px] text-[#92400e]">{getSpeechToTextErrorMessage(voice.error)}</p> : null}
            {voice.phase === "finishing" ? (
              <p className="mt-2 text-[12px] text-[#666]">Finalizando grabacion...</p>
            ) : null}
            {voice.phase === "transcript_ready" ? (
              <p className="mt-2 text-[12px] text-[#166534]">Transcript listo para editar.</p>
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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-[#666]">
                Revisa el transcript y luego envia manualmente.
              </span>
            </div>
          </div>

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
              {sending ? "Refinando..." : "Enviar"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

