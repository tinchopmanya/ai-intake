"use client";

import { useEffect } from "react";

import { Button, Textarea } from "@/components/mvp/ui";
import { VoiceListeningBadge, VoiceMicButton } from "@/components/mvp/VoiceControls";
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

type AdvisorChatModalProps = {
  isOpen: boolean;
  advisorName: string;
  messages: AdvisorChatMessage[];
  draft: string;
  sending: boolean;
  helperCopy?: string;
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
  helperCopy,
  onDraftChange,
  onSend,
  onUseResponse,
  onClose,
}: AdvisorChatModalProps) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const voice = useSpeechToText({
    lang: "es-ES",
    continuous: false,
    interimResults: false,
  });
  const microphoneStatusMessage = getMicrophoneStatusMessage(
    voice.microphoneStatus,
    voice.speechSupported,
  );

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
            <p className="text-sm text-[#666]">
              {helperCopy || "Escribe una instruccion para refinar la respuesta."}
            </p>
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
          {helperCopy && messages.length > 0 ? <p className="text-[13px] text-[#666]">{helperCopy}</p> : null}
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
                idleLabel="Hablar"
                listeningLabel="Escuchando..."
              />

              <VoiceMicButton
                listening={false}
                disabled={voice.listening || voice.microphoneStatus === "requesting"}
                onClick={() => {
                  voice.startListening();
                }}
                idleLabel="Desahogarte con este advisor"
                listeningLabel="Desahogarte con este advisor"
              />

              <VoiceListeningBadge listening={voice.listening} />
            </div>

            {microphoneStatusMessage ? <p className="text-[12px] text-[#666]">{microphoneStatusMessage}</p> : null}
            {!microphoneStatusMessage && voice.speechSupported ? (
              <p className="text-[12px] text-[#666]">Puedes hablar libremente y luego revisar el texto antes de enviarlo.</p>
            ) : null}

            {voice.error ? <p className="text-[12px] text-[#92400e]">{getSpeechToTextErrorMessage(voice.error)}</p> : null}

            {isDevelopment ? (
              <button
                type="button"
                onClick={() => {
                  void voice.requestMicrophonePermission();
                }}
                disabled={voice.microphoneStatus === "requesting"}
                className="inline-flex h-8 items-center rounded-full border border-[#d7d7d7] bg-white px-3 text-[12px] text-[#334155] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Probar microfono
              </button>
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
