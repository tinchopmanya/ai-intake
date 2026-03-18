"use client";

import { useEffect, useMemo, useState } from "react";
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
  onDraftChange,
  onSend,
  onUseResponse,
  onClose,
}: AdvisorChatModalProps) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const [voiceUiDebugEvents, setVoiceUiDebugEvents] = useState<
    Array<{ at: string; event: string; details?: Record<string, unknown> }>
  >([]);
  const preferredVoiceLang = useMemo(() => {
    if (typeof navigator === "undefined") return "es-ES";
    const browserLanguages = [navigator.language, ...(navigator.languages ?? [])]
      .filter((item): item is string => Boolean(item))
      .map((item) => item.toLowerCase());
    return browserLanguages.some((item) => item.startsWith("es-uy")) ? "es-UY" : "es-ES";
  }, []);

  const voice = useSpeechToText({
    lang: preferredVoiceLang,
    continuous: false,
    interimResults: true,
    silenceTimeoutMs: 0,
    noSpeechIsRecoverable: true,
    emitNoSpeechOnEnd: true,
  });
  const voiceListening = voice.listening;
  const stopVoiceListening = voice.stopListening;
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
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  function pushVoiceUiDebugEvent(event: string, details?: Record<string, unknown>) {
    if (!isDevelopment) return;
    const entry = {
      at: new Date().toISOString(),
      event,
      details,
    };
    setVoiceUiDebugEvents((current) => [...current.slice(-39), entry]);
    if (details) {
      console.debug("[voice][advisor-modal]", event, details);
    } else {
      console.debug("[voice][advisor-modal]", event);
    }
  }

  const voiceUiState = useMemo(() => {
    if (voice.error) return "error" as const;
    if (voice.phase === "listening") return "listening" as const;
    if (voice.phase === "finishing") return "processing" as const;
    if (voice.transcript.trim()) return "transcript_ready" as const;
    return "idle" as const;
  }, [voice.error, voice.phase, voice.transcript]);

  const stateCopy = useMemo(() => {
    switch (voiceUiState) {
      case "listening":
        return {
          title: "Escuchando...",
          description: "Habla con naturalidad. Puedes terminar cuando quieras.",
        };
      case "processing":
        return {
          title: "Procesando lo que dijiste...",
          description: "Estamos finalizando la transcripcion.",
        };
      case "transcript_ready":
        return {
          title: "Esto es lo que entendi",
          description: "Revisalo antes de enviarlo al advisor.",
        };
      case "error":
        if (voice.error === "voice_no_speech") {
          return {
            title: "No detecte tu voz",
            description: "No detecte tu voz. Intenta de nuevo y habla apenas empiece a escuchar.",
          };
        }
        return {
          title: "No se pudo completar la grabacion",
          description: getSpeechToTextErrorMessage(voice.error) ?? "Intenta de nuevo.",
        };
      case "idle":
      default:
        return {
          title: "Listo para escucharte",
          description: "Pulsa iniciar cuando quieras grabar tu mensaje.",
        };
    }
  }, [voice.error, voiceUiState]);

  function focusDraftInput() {
    window.setTimeout(() => {
      const input = document.getElementById("advisor-chat-draft") as HTMLTextAreaElement | null;
      input?.focus();
    }, 30);
  }

  function openVoiceModal() {
    if (voice.clearDebugEvents) {
      voice.clearDebugEvents();
    }
    setVoiceUiDebugEvents([]);
    pushVoiceUiDebugEvent("talk button clicked", {
      voiceModalOpen,
      phase: voice.phase,
      listening: voice.listening,
    });
    setVoiceModalOpen(true);
    voice.resetTranscript();
    void voice.requestMicrophonePermission();
  }

  function closeVoiceModal() {
    pushVoiceUiDebugEvent("voice modal closed", { listening: voice.listening });
    if (voice.listening) {
      voice.stopListening();
    }
    setVoiceModalOpen(false);
    voice.resetTranscript();
  }

  function handleCloseAdvisorModal() {
    closeVoiceModal();
    onClose();
  }

  function startOrRestartRecording() {
    pushVoiceUiDebugEvent("start/restart recording clicked", {
      listening: voice.listening,
      phase: voice.phase,
      error: voice.error,
      hasTranscript: Boolean(voice.transcript.trim()),
    });
    if (voice.listening) {
      voice.stopListening();
    }
    voice.resetTranscript();
    voice.startListening();
  }

  function applyTranscriptToDraft() {
    pushVoiceUiDebugEvent("apply transcript clicked", {
      transcriptLength: voice.transcript.trim().length,
    });
    const transcript = voice.transcript.trim();
    if (!transcript) return;
    const merged = draft.trim() ? `${draft.trim()}\n${transcript}` : transcript;
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
    closeVoiceModal();
    focusDraftInput();
  }

  useEffect(() => {
    if (!isOpen && voiceListening) {
      stopVoiceListening();
    }
  }, [isOpen, stopVoiceListening, voiceListening]);

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
            onClick={handleCloseAdvisorModal}
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
                onClick={openVoiceModal}
                idleLabel="Hablar con el advisor"
                listeningLabel="Escuchando..."
              />
              {voice.transcript.trim() ? (
                <span className="inline-flex h-8 items-center rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 text-[12px] text-[#166534]">
                  Transcript listo para revisar
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

        {voiceModalOpen ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/55 p-4">
            <div className="w-full max-w-3xl rounded-3xl border border-[#dbe3ec] bg-gradient-to-b from-[#ffffff] to-[#f8fbff] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.35)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative">
                    <span
                      className={`voice-avatar-ring ${voiceUiState === "listening" ? "is-active" : ""}`}
                      aria-hidden
                    />
                    {advisorAvatarSrc ? (
                      <Image
                        src={advisorAvatarSrc}
                        alt={advisorName}
                        width={64}
                        height={64}
                        className="relative z-10 h-16 w-16 rounded-full border border-[#dbe3ec] object-cover"
                      />
                    ) : (
                      <span className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-[#111827] text-sm font-semibold text-white">
                        {advisorName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[18px] font-semibold text-[#0f172a]">{advisorName}</p>
                    {advisorRole ? (
                      <p className="text-[13px] font-medium text-[#475569]">{advisorRole}</p>
                    ) : null}
                    <p className="mt-1 text-[13px] text-[#334155]">{stateCopy.title}</p>
                    <p className="text-[12px] text-[#64748b]">{stateCopy.description}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeVoiceModal}
                  className="border-[#cbd5e1] bg-white px-3 py-1.5 text-sm text-[#334155]"
                >
                  Cerrar
                </Button>
              </div>

              <div className="mt-5 rounded-2xl border border-[#e2e8f0] bg-white/80 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[12px] font-medium uppercase tracking-wide text-[#64748b]">
                    Estado
                  </span>
                  <span
                    className={`inline-flex h-7 items-center rounded-full border px-3 text-[12px] ${
                      voiceUiState === "listening"
                        ? "border-[#fecaca] bg-[#fff1f2] text-[#b42318]"
                        : voiceUiState === "processing"
                          ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
                          : voiceUiState === "transcript_ready"
                            ? "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
                            : voiceUiState === "error"
                              ? "border-[#fcd34d] bg-[#fffbeb] text-[#92400e]"
                              : "border-[#e2e8f0] bg-[#f8fafc] text-[#334155]"
                    }`}
                  >
                    {voiceUiState === "listening"
                      ? "Escuchando"
                      : voiceUiState === "processing"
                        ? "Procesando"
                        : voiceUiState === "transcript_ready"
                          ? "Transcript listo"
                          : voiceUiState === "error"
                            ? "Error"
                            : "En espera"}
                  </span>
                </div>

                <div className="mb-4 flex h-14 items-end justify-center gap-1.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
                  {Array.from({ length: 14 }).map((_, index) => (
                    <span
                      key={`voice-bar-${index}`}
                      className={`voice-level-bar ${voiceUiState === "listening" ? "is-active" : ""}`}
                      style={{ animationDelay: `${index * 70}ms` }}
                      aria-hidden
                    />
                  ))}
                </div>

                <p className="mb-2 text-[12px] font-medium text-[#334155]">Transcript</p>
                <p className="min-h-24 whitespace-pre-wrap break-words rounded-xl border border-[#dbe3ec] bg-[#f8fafc] px-3 py-2 text-[14px] text-[#0f172a]">
                  {voice.transcript.trim()
                    ? voice.transcript.trim()
                    : voiceUiState === "listening"
                      ? "Estoy escuchando. Habla cuando quieras."
                      : "Aun no hay transcript."}
                </p>
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {voiceUiState === "listening" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={voice.stopListening}
                    className="border-[#fecdd3] bg-white text-[#9f1239] hover:bg-[#fff1f2]"
                  >
                    Terminar grabacion
                  </Button>
                ) : null}

                {voiceUiState === "idle" || voiceUiState === "error" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={startOrRestartRecording}
                    className="border-[#cbd5e1] bg-white text-[#334155]"
                  >
                    {voice.error === "voice_no_speech" ? "Reintentar" : "Iniciar grabacion"}
                  </Button>
                ) : null}

                {voiceUiState === "transcript_ready" ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={startOrRestartRecording}
                      className="border-[#cbd5e1] bg-white text-[#334155]"
                    >
                      Volver a grabar
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={applyTranscriptToDraft}
                      className="bg-[#1d4ed8] text-white hover:bg-[#1e40af]"
                    >
                      Enviar transcript
                    </Button>
                  </>
                ) : null}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeVoiceModal}
                  className="border-[#cbd5e1] bg-white text-[#334155]"
                >
                  Cancelar
                </Button>
              </div>

              {isDevelopment ? (
                <details className="mt-4 rounded-xl border border-[#e2e8f0] bg-white/70 p-3">
                  <summary className="cursor-pointer text-[12px] font-medium text-[#334155]">
                    Debug voz (solo desarrollo)
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-[#334155]">
                    {JSON.stringify(
                      {
                        speechSupported: voice.speechSupported,
                        microphoneStatus: voice.microphoneStatus,
                        phase: voice.phase,
                        listening: voice.listening,
                        transcriptSource: voice.transcriptSource,
                        resultCount: voice.resultCount,
                        recognitionConfig: voice.config,
                        lastSessionDurationMs: voice.lastSessionDurationMs,
                        lastSessionHadResult: voice.lastSessionHadResult,
                        lastSessionHadTranscript: voice.lastSessionHadTranscript,
                        transcriptPreview: voice.transcript.slice(0, 280),
                        error: voice.error,
                        uiEvents: voiceUiDebugEvents,
                        hookEvents: voice.debugEvents ?? [],
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
