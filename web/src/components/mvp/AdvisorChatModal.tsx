"use client";

import { useEffect } from "react";

import { Button, Textarea } from "@/components/mvp/ui";
import { useSpeechToText } from "@/hooks/useSpeechToText";

export type AdvisorChatMessage = {
  id: string;
  role: "user" | "advisor";
  text: string;
};

type AdvisorChatModalProps = {
  isOpen: boolean;
  advisorName: string;
  messages: AdvisorChatMessage[];
  draft: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onUseResponse: () => void;
  onClose: () => void;
};

export function AdvisorChatModal({
  isOpen,
  advisorName,
  messages,
  draft,
  sending,
  onDraftChange,
  onSend,
  onUseResponse,
  onClose,
}: AdvisorChatModalProps) {
  const voice = useSpeechToText({
    lang: "es-ES",
    continuous: false,
    interimResults: false,
  });

  useEffect(() => {
    if (!isOpen || !voice.transcript.trim()) return;
    const merged = draft.trim() ? `${draft.trim()}\n${voice.transcript.trim()}` : voice.transcript.trim();
    onDraftChange(merged);
    voice.resetTranscript();
  }, [draft, isOpen, onDraftChange, voice]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3">
      <div className="flex h-[min(88vh,740px)] w-full max-w-2xl flex-col rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
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

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#F8FAFC] p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-[#64748B]">Escribe una instruccion para refinar la respuesta.</p>
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
          <Textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="Ej: manten el limite pero mas breve y neutral."
            className="border-[#E2E8F0] bg-white text-[#0F172A]"
          />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!voice.supported) return;
                  if (voice.listening) {
                    voice.stopListening();
                  } else {
                    voice.startListening();
                  }
                }}
                disabled={!voice.supported}
                className="rounded-md border border-[#ddd] bg-white px-3 py-1.5 text-[13px] text-[#111] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:text-[#999]"
              >
                {voice.listening ? "Detener" : "Hablar"}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!voice.supported) return;
                  voice.startListening();
                }}
                disabled={!voice.supported || voice.listening}
                className="rounded-md border border-[#ddd] bg-white px-3 py-1.5 text-[13px] text-[#111] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:text-[#999]"
              >
                Desahogarte con este advisor
              </button>

              {voice.listening ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-[#b91c1c]">
                  <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
                  Escuchando...
                </span>
              ) : null}
            </div>

            {!voice.supported ? (
              <p className="text-[12px] text-[#666]">La entrada por voz no esta disponible en este navegador.</p>
            ) : (
              <p className="text-[12px] text-[#666]">Puedes hablar libremente y luego revisar el texto antes de enviarlo.</p>
            )}

            {voice.error ? (
              <p className="text-[12px] text-[#92400e]">No pudimos transcribir el audio. Intenta de nuevo.</p>
            ) : null}
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
