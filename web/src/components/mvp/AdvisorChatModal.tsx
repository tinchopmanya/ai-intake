"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import {
  advisorDarkHeaderClass,
  advisorDarkHeaderGlowClass,
  advisorMutedSurfaceClass,
  advisorPanelShellClass,
} from "@/components/mvp/advisorUiStyles";
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
  const headerAvatarSrc = useMemo(() => {
    if (!advisorAvatarSrc) return null;
    if (advisorAvatarSrc.includes("_128")) return advisorAvatarSrc;
    return advisorAvatarSrc.replace("_64", "_128");
  }, [advisorAvatarSrc]);
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
  const voiceSupportCopy =
    microphoneStatusMessage ??
    (voice.speechSupported
      ? "Puedes usar dictado por voz en este navegador."
      : "La entrada por voz no esta disponible en este navegador.");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]">
      <div className={`relative flex h-[min(92vh,840px)] w-full max-w-3xl flex-col overflow-hidden ${advisorPanelShellClass}`}>
        <header className={`${advisorDarkHeaderClass} px-4 py-2.5 md:px-5 md:py-3`}>
          <div className={advisorDarkHeaderGlowClass} aria-hidden />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              {advisorAvatarSrc ? (
                <Image
                  src={headerAvatarSrc}
                  alt={advisorName}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-2xl border border-white/18 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.2)]"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/18 bg-white/12 text-[12px] font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.2)]">
                  {advisorName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 pt-0.5">
                <p className="truncate text-[16px] font-semibold tracking-[-0.01em] text-white">{advisorName}</p>
                {advisorRole ? (
                  <p className="mt-0.5 text-[12px] font-medium text-slate-200/92">{advisorRole}</p>
                ) : null}
                {advisorDescription ? (
                  <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-200/82">{advisorDescription}</p>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseAdvisorModal}
              className="shrink-0 border-white/15 bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-sm hover:bg-white/16"
            >
              Cerrar
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,#f3f6fa_0%,#eef3f8_100%)] px-4 py-3 md:px-5 md:py-4">
          <div className="h-full overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3.5 text-[13px] leading-6 text-[#475569] shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                {resolvedHelperCopy}
              </div>
            ) : (
              <div className="space-y-3 pb-1">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[90%] whitespace-pre-wrap break-words rounded-[22px] border px-4 py-2.5 text-[13px] leading-6 shadow-[0_10px_24px_rgba(15,23,42,0.05)] ${
                          isUser
                            ? "border-[#b9e5c7] bg-[#edf9f1] text-[#166534]"
                            : "border-[#ccdbff] bg-[#edf4ff] text-[#1e40af]"
                        }`}
                      >
                        <p
                          className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                            isUser ? "text-[#15803d]" : "text-[#3156b7]"
                          }`}
                        >
                          {isUser ? "Tu" : advisorName}
                        </p>
                        <p>{message.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="space-y-3 border-t border-[#dbe4ee] bg-white/95 px-4 py-3 md:px-5 md:py-4">
          <div
            id="advisor-chat-draft-wrap"
            className="rounded-2xl border border-[#dbe4ee] bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition-all duration-200"
          >
            <Textarea
              id="advisor-chat-draft"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={inputPlaceholder}
              className="border-0 bg-transparent px-3 py-2.5 text-[13px] leading-6 text-[#0F172A] placeholder:text-[#7c8b9d] focus:ring-0"
            />
          </div>

          <div className="space-y-2">
            <div className={`${advisorMutedSurfaceClass} flex flex-wrap items-center gap-2 px-3 py-2.5`}>
              <VoiceMicButton
                listening={voice.listening}
                disabled={voice.microphoneStatus === "requesting"}
                onClick={openVoiceModal}
                idleLabel="Hablar con el advisor"
                listeningLabel="Escuchando..."
                iconOnly
                ariaLabel="Hablar con el advisor"
                className="border-[#cad5e2] bg-white text-[#526173] shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-[#b7c7d9] hover:bg-[#f8fbff]"
              />
              <p className="min-w-0 flex-1 text-[12px] leading-5 text-[#526173]">{voiceSupportCopy}</p>
              {isDevelopment ? (
                <button
                  type="button"
                  onClick={() => {
                    void voice.requestMicrophonePermission();
                  }}
                  disabled={voice.microphoneStatus === "requesting"}
                  className="inline-flex h-8 items-center rounded-full border border-[#cad5e2] bg-white px-3 text-[12px] font-medium text-[#334155] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Probar microfono
                </button>
              ) : null}
            </div>

            {voice.error ? (
              <p className="text-[12px] leading-5 text-[#92400e]">{getSpeechToTextErrorMessage(voice.error)}</p>
            ) : null}

            {!voice.error && voice.transcript.trim() ? (
              <span className="inline-flex h-7 items-center rounded-full border border-[#b9e5c7] bg-[#edf9f1] px-3 text-[11px] font-medium text-[#166534]">
                Transcript listo para revisar
              </span>
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

          <div className="flex flex-wrap justify-between gap-2 pt-0.5">
            <Button
              type="button"
              variant="secondary"
              onClick={onUseResponse}
              className="border-[#CBD5E1] bg-white px-4 py-2 text-[13px] font-medium text-[#334155]"
            >
              Usar esta respuesta
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={sending || !draft.trim()}
              onClick={onSend}
              className="bg-[#1D4ED8] px-4 py-2 text-[13px] font-medium shadow-[0_8px_20px_rgba(29,78,216,0.24)] hover:bg-[#1E40AF]"
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
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
            <div className={`w-full max-w-2xl overflow-hidden ${advisorPanelShellClass}`}>
              <div className={`${advisorDarkHeaderClass} px-4 py-3`}>
                <div className={advisorDarkHeaderGlowClass} aria-hidden />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative">
                      <span
                        className={`voice-avatar-ring ${voiceUiState === "listening" ? "is-active" : ""}`}
                        aria-hidden
                      />
                      {headerAvatarSrc ? (
                        <Image
                          src={headerAvatarSrc}
                          alt={advisorName}
                          width={48}
                          height={48}
                          className="relative z-10 h-12 w-12 rounded-2xl border border-white/18 object-cover"
                        />
                      ) : (
                        <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/18 bg-white/12 text-[12px] font-semibold text-white">
                          {advisorName.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold text-white">{advisorName}</p>
                      {advisorRole ? (
                        <p className="mt-0.5 text-[12px] font-medium text-slate-200/92">{advisorRole}</p>
                      ) : null}
                      <p className="mt-1 text-[12px] text-slate-100/95">{stateCopy.title}</p>
                      <p className="text-[11px] leading-5 text-slate-200/80">{stateCopy.description}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeVoiceModal}
                    className="shrink-0 border-white/15 bg-white/10 px-3 py-1.5 text-[13px] text-white hover:bg-white/16"
                  >
                    Cerrar
                  </Button>
                </div>
              </div>

              <div className="space-y-4 bg-[#f8fafc] p-4">
                <div className={`${advisorMutedSurfaceClass} p-3.5`}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#64748b]">
                      Estado
                    </span>
                    <span
                      className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium ${
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

                  <div className="mb-3 flex h-11 items-end justify-center gap-1 rounded-xl border border-[#d8e1eb] bg-white/75 px-3 py-2">
                    {Array.from({ length: 14 }).map((_, index) => (
                      <span
                        key={`voice-bar-${index}`}
                        className={`voice-level-bar ${voiceUiState === "listening" ? "is-active" : ""}`}
                        style={{ animationDelay: `${index * 70}ms` }}
                        aria-hidden
                      />
                    ))}
                  </div>

                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#64748b]">
                    Transcript
                  </p>
                  <p className="min-h-20 whitespace-pre-wrap break-words rounded-xl border border-[#dbe3ec] bg-white px-3 py-2.5 text-[13px] leading-6 text-[#0f172a]">
                    {voice.transcript.trim()
                      ? voice.transcript.trim()
                      : voiceUiState === "listening"
                        ? "Estoy escuchando. Habla cuando quieras."
                        : "Aun no hay transcript."}
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {voiceUiState === "listening" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={voice.stopListening}
                      className="border-[#fecdd3] bg-white px-4 py-2 text-[13px] text-[#9f1239] hover:bg-[#fff1f2]"
                    >
                      Terminar grabacion
                    </Button>
                  ) : null}

                  {voiceUiState === "idle" || voiceUiState === "error" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={startOrRestartRecording}
                      className="border-[#cbd5e1] bg-white px-4 py-2 text-[13px] text-[#334155]"
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
                        className="border-[#cbd5e1] bg-white px-4 py-2 text-[13px] text-[#334155]"
                      >
                        Volver a grabar
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={applyTranscriptToDraft}
                        className="bg-[#1d4ed8] px-4 py-2 text-[13px] text-white hover:bg-[#1e40af]"
                      >
                        Enviar transcript
                      </Button>
                    </>
                  ) : null}

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeVoiceModal}
                    className="border-[#cbd5e1] bg-white px-4 py-2 text-[13px] text-[#334155]"
                  >
                    Cancelar
                  </Button>
                </div>

                {isDevelopment ? (
                  <details className="rounded-xl border border-[#e2e8f0] bg-white/75 p-3">
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
