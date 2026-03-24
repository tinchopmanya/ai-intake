"use client";

import { type ChangeEvent, type ClipboardEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import styles from "@/components/mvp/MvpShell.module.css";
import { VoicePlaybackButton } from "@/components/mvp/VoiceControls";
import { Button, Panel, Textarea } from "@/components/mvp/ui";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { authFetch } from "@/lib/auth/client";
import { hasStoredSession } from "@/lib/auth/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import {
  getCases,
  postAdvisor,
  postAdvisorChat,
  postAnalysis,
  postIncident,
  postOcrInterpret,
  postWizardEvent,
} from "@/lib/api/client";
import type { AdvisorProfile } from "@/data/advisors";
import { API_URL } from "@/lib/config";
import { resolveRuntimeLocale, tRuntime } from "@/lib/i18n/runtime";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import {
  getMicrophoneStatusMessage,
  getSpeechToTextErrorMessage,
  useSpeechToText,
} from "@/hooks/useSpeechToText";
import type {
  AdvisorResponse,
  AnalysisResponse,
  AnalysisRiskFlag,
  CaseSummary,
  IncidentType,
  OcrCapabilitiesResponse,
  OcrExtractResponse,
  UsageMode,
} from "@/lib/api/types";

const ADVISOR_FALLBACK_VISUAL = {
  id: "generic",
  name: "Advisor",
  role: "Perspectiva",
  avatar64: "/advisors/generic.svg",
  avatar128: "/advisors/generic.svg",
};

type ResponseTone = "cordial" | "firme_respetuoso" | "amigable";

type ConversationBlock = {
  id: string;
  speaker: "ex_partner" | "user" | "unknown";
  content: string;
  confidence?: number;
  source?: "manual" | "ocr";
};

type AnalysisStatusKind = "ok" | "observation" | "risk";

const RISK_LABELS: Record<string, string> = {
  custody_related: "Tema sensible detectado: custodia y coparentalidad",
  high_emotion: "Carga emocional elevada",
  passive_aggressive: "Posible tono pasivo-agresivo",
  legal_sensitive: "Tema legal sensible",
  urgency_conflict: "Urgencia con riesgo de escalada",
  boundary_pressure: "Presion o manipulacion detectada",
};

const SEVERITY_LABELS: Record<AnalysisRiskFlag["severity"], string> = {
  low: "gravedad baja",
  medium: "gravedad media",
  high: "gravedad alta",
};

const OCR_EXTRACT_URL = `${API_URL}/v1/ocr/extract`;
const OCR_CAPABILITIES_URL = `${API_URL}/v1/ocr/capabilities`;

const OCR_ERROR_MESSAGES: Record<string, string> = {
  missing_image_file: "Selecciona una imagen para continuar.",
  unsupported_image_mime_type: "Formato no compatible. Usa PNG, JPG o WebP.",
  empty_file: "La imagen seleccionada esta vacia.",
  file_too_large: "La imagen es demasiado grande.",
  python_multipart_not_installed: "OCR no disponible en este entorno.",
  ocr_no_text_detected: "No detectamos texto legible. Prueba otra captura mas nítida.",
  invalid_image_file: "No pudimos leer la imagen. Prueba con otro archivo.",
  pillow_not_installed: "OCR no disponible por configuracion del servidor.",
  pytesseract_not_installed: "OCR no disponible por configuracion del servidor.",
  tesseract_not_installed: "OCR no disponible: falta Tesseract en el servidor.",
  tesseract_not_available: "OCR no disponible en este servidor.",
  tesseract_binary_not_found: "OCR no disponible: Tesseract no fue encontrado.",
  tesseract_language_not_available: "OCR no disponible para el idioma configurado.",
  tesseract_execution_failed: "No se pudo procesar la imagen con OCR.",
  google_vision_dependency_missing: "OCR no disponible por configuracion del servidor.",
  google_vision_not_configured: "OCR no disponible: Google Vision no esta configurado.",
  google_vision_request_failed: "No se pudo procesar la imagen en este momento.",
  ocr_unavailable: "OCR no esta disponible ahora. Intenta de nuevo mas tarde.",
  ocr_internal_error: "Error interno al leer la imagen.",
  invalid_or_expired_session: "Tu sesion expiro. Inicia sesion nuevamente.",
  missing_bearer_token: "Necesitas iniciar sesion para usar OCR.",
};

function resolveOcrErrorMessage(detail?: string, message?: string): string {
  if (detail && OCR_ERROR_MESSAGES[detail]) {
    return OCR_ERROR_MESSAGES[detail];
  }
  if (message && message.trim()) {
    return message;
  }
  return "No se pudo leer el texto de la imagen.";
}

function getAdvisorVisualByIndex(index: number) {
  return ADVISOR_PROFILES[index] ?? ADVISOR_FALLBACK_VISUAL;
}

function getAdvisorAvatar(
  advisor: ReturnType<typeof getAdvisorVisualByIndex>,
  variant: "64" | "128",
) {
  if (variant === "64") return advisor.avatar64 ?? advisor.avatar128;
  return advisor.avatar128 ?? advisor.avatar64;
}

function createConversationBlock(
  speaker: ConversationBlock["speaker"],
  content: string,
  source: ConversationBlock["source"] = "manual",
  confidence?: number,
): ConversationBlock {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    speaker,
    content: content.trim(),
    confidence,
    source,
  };
}

function formatConversationBlocksForContext(blocks: ConversationBlock[]): string {
  return blocks
    .map((block) => {
      const text = block.content.trim();
      if (!text) return null;
      const prefix =
        block.speaker === "user"
          ? "Yo"
          : block.speaker === "ex_partner"
            ? "Ex pareja"
            : "Sin identificar";
      return `${prefix}: ${text}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function looksLikeConversationInput(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 3) return true;
  if (/(yo|me|ex|ex pareja|tu|vos)\s*[:\-]/i.test(normalized)) return true;
  return /\d{1,2}:\d{2}/.test(normalized) && lines.length >= 2;
}

function heuristicSegmentConversation(
  text: string,
  source: ConversationBlock["source"],
): ConversationBlock[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const blocks: ConversationBlock[] = [];
  let currentSpeaker: ConversationBlock["speaker"] = "ex_partner";
  let currentLines: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/\s+\d{1,2}:\d{2}(?:\s*[ap]\.?\s*m\.?)?$/i, "").trim();
    if (!cleaned) continue;

    const marker = cleaned.match(
      /^(yo|me|mi|tu|vos|ex|expareja|ex pareja|ella|el)\s*[:\-]\s*(.+)$/i,
    );
    let speaker: ConversationBlock["speaker"] = currentSpeaker;
    let content = cleaned;

    if (marker) {
      const label = marker[1].toLowerCase();
      speaker = ["yo", "me", "mi", "tu", "vos"].includes(label) ? "user" : "ex_partner";
      content = marker[2].trim();
    }

    if (currentLines.length > 0 && speaker !== currentSpeaker) {
      blocks.push(createConversationBlock(currentSpeaker, currentLines.join(" "), source));
      currentLines = [];
    }
    currentSpeaker = speaker;
    currentLines.push(content);
  }

  if (currentLines.length > 0) {
    blocks.push(createConversationBlock(currentSpeaker, currentLines.join(" "), source));
  }
  return blocks.filter((block) => block.content.length > 0);
}

function getLatestExPartnerMessage(blocks: ConversationBlock[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) continue;
      if (block.speaker === "ex_partner" && block.content.trim()) {
        return block.content.trim();
      }
  }
  return null;
}

function getConversationSubmissionText(
  blocks: ConversationBlock[],
  fallbackText: string,
): string {
  const structured = formatConversationBlocksForContext(blocks).trim();
  if (structured) return structured;
  return fallbackText.trim();
}

function mapConversationSpeakerToHistorySender(
  speaker: ConversationBlock["speaker"],
): "incoming" | "outgoing" | "unknown" {
  if (speaker === "user") return "outgoing";
  if (speaker === "ex_partner") return "incoming";
  return "unknown";
}

/**
 * Returns true when at least one medium/high severity signal is present.
 */
function hasRelevantRisk(flags: AnalysisRiskFlag[]) {
  return flags.some((flag) => flag.severity === "medium" || flag.severity === "high");
}

/**
 * Detects mild conflict signals even when hard risk flags are absent.
 */
function hasModerateSignal(analysisResult: AnalysisResponse) {
  const tone = analysisResult.emotional_context.tone.toLowerCase();
  return (
    analysisResult.risk_flags.length > 0 ||
    analysisResult.ui_alerts.length > 0 ||
    tone.includes("ten") ||
    tone.includes("host") ||
    tone.includes("ang") ||
    tone.includes("emoc") ||
    tone.includes("conflict")
  );
}

function getAnalysisStatus(analysisResult: AnalysisResponse): {
  kind: AnalysisStatusKind;
  title: string;
  description: string;
  className: string;
} {
  if (hasRelevantRisk(analysisResult.risk_flags)) {
    return {
      kind: "risk",
      title: "Conversacion delicada",
      description: "Detectamos senales que pueden escalar el conflicto.",
      className: "border-[#fca5a5] bg-[#fef2f2] text-[#991b1b]",
    };
  }

  if (hasModerateSignal(analysisResult)) {
    return {
      kind: "observation",
      title: "Conversacion sensible",
      description: "Hay algunos puntos que conviene manejar con cuidado.",
      className: "border-[#fcd34d] bg-[#fffbeb] text-[#92400e]",
    };
  }

  return {
    kind: "ok",
    title: "Conversacion estable",
    description: "No detectamos senales relevantes de conflicto.",
    className: "border-[#86efac] bg-[#ecfdf5] text-[#166534]",
  };
}

function getRiskMeter(analysisResult: AnalysisResponse): {
  level: "low" | "medium" | "high";
  value: number;
} {
  const severities = analysisResult.risk_flags.map((flag) => flag.severity);
  if (severities.includes("high")) return { level: "high", value: 88 };
  if (severities.includes("medium")) return { level: "medium", value: 58 };
  if (severities.includes("low")) return { level: "low", value: 32 };
  if (analysisResult.ui_alerts.length > 0) return { level: "medium", value: 48 };
  return { level: "low", value: 16 };
}

function getAnalysisQuickChips(analysisResult: AnalysisResponse) {
  const tone = analysisResult.emotional_context.tone || "Neutro";
  const friction =
    analysisResult.risk_flags.length === 0
      ? "Baja"
      : analysisResult.risk_flags.some((flag) => flag.severity === "high")
        ? "Alta"
        : analysisResult.risk_flags.some((flag) => flag.severity === "medium")
          ? "Media"
          : "Moderada";
  const urgency =
    analysisResult.ui_alerts.some((alert) => /urg/i.test(alert.message)) ||
    analysisResult.risk_flags.some((flag) => /urgency/i.test(flag.code))
      ? "Alta"
      : "Normal";
  const clarity =
    analysisResult.summary.length > 180 || analysisResult.ui_alerts.length > 2 ? "Media" : "Alta";

  return [
    { label: "Tono", value: tone },
    { label: "Friccion", value: friction },
    { label: "Urgencia", value: urgency },
    { label: "Claridad", value: clarity },
  ];
}

function humanizeFlag(flag: AnalysisRiskFlag) {
  const label =
    RISK_LABELS[flag.code] ??
    flag.code
      .replaceAll("_", " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  return `${label} (${SEVERITY_LABELS[flag.severity]})`;
}

function getResponseBadgeLabel(emotionLabel: AdvisorResponse["responses"][number]["emotion_label"] | undefined) {
  switch (emotionLabel) {
    case "empathetic":
      return "Empatica";
    case "assertive":
      return "Firme";
    case "calm":
      return "Calma";
    case "friendly":
      return "Amable";
    case "apologetic":
      return "Cuidadosa";
    case "neutral":
    default:
      return "Neutral";
  }
}

function buildSidebarConversationTitle(
  blocks: ConversationBlock[],
  fallbackText: string,
): string {
  const source = getConversationSubmissionText(blocks, fallbackText).toLowerCase();

  if (!source.trim()) return "Conversacion reciente";
  if (/(gasto|gastos|pago|pagos|dinero|plata|transferencia|cuota|reintegro|deuda)/.test(source)) {
    return "Diferencia por gastos";
  }
  if (/(visita|visitas|retiro|retiro|entrega|buscar|llevar|pasar|fin de semana)/.test(source)) {
    return "Coordinacion sobre visita";
  }
  if (/(horario|horarios|hora|horas|turno|turnos|agenda|calendario)/.test(source)) {
    return "No acuerdo sobre horarios";
  }
  if (/(colegio|escuela|medico|doctor|vacuna|rutina|hijo|hija|hijos|familia)/.test(source)) {
    return "Consulta sobre organizacion familiar";
  }
  if (/(documento|documentos|permiso|papeles|firma|formulario)/.test(source)) {
    return "Consulta sobre documentacion";
  }
  if (/(vacaciones|viaje|viajes)/.test(source)) {
    return "Coordinacion de vacaciones";
  }
  return "Tema en revision";
}

/**
 * Visual step indicator for intake, analysis and response stages.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Stepper({
  currentStep,
  labels,
}: {
  currentStep: 1 | 2 | 3;
  labels: [string, string, string];
}) {
  const steps = [
    { id: 1, label: labels[0] },
    { id: 2, label: labels[1] },
    { id: 3, label: labels[2] },
  ] as const;

  return (
    <div className="flex items-center gap-2 overflow-hidden py-1 text-xs text-[#334155] sm:text-sm">
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.id;
        const isActive = currentStep === step.id;
        const isPending = currentStep < step.id;

        return (
          <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold sm:h-7 sm:w-7 ${
                  isCompleted
                    ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                    : isActive
                      ? "border-[#334155] bg-[#334155] text-white"
                      : "border-gray-300 bg-white text-gray-400"
                }`}
              >
                {isCompleted ? "✓" : isActive ? String(step.id) : "○"}
              </span>
              <span
                className={`min-w-0 truncate font-medium ${
                  isPending ? "text-gray-400" : "text-[#1f2937]"
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 ? (
              (() => {
                const nextStep = steps[index + 1];
                const connectorClass =
                  nextStep && nextStep.id < currentStep
                    ? "bg-[#1a7a5e]"
                    : "bg-[var(--color-border-tertiary)]";
                return <span className={`h-px min-w-[12px] flex-1 ${connectorClass}`} />;
              })()
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Reusable wrapper for each wizard step content block.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function StepSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-[#e5e7eb] bg-[#f8fafc] p-3">
      <h4 className="text-sm font-semibold text-[#1f2937]">{title}</h4>
      <div className="mt-2 space-y-2 text-sm leading-6 text-[#334155]">{children}</div>
    </article>
  );
}

function ShellStepper({
  currentStep,
  labels,
}: {
  currentStep: 1 | 2 | 3;
  labels: [string, string, string];
}) {
  const steps = [
    { id: 1, label: labels[0] },
    { id: 2, label: labels[1] },
    { id: 3, label: labels[2] },
  ] as const;

  return (
    <div className={styles.wizardStepper}>
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.id;
        const isActive = currentStep === step.id;
        const isPending = currentStep < step.id;
        const nextStep = steps[index + 1];
        const connectorClass =
          nextStep && nextStep.id < currentStep
            ? `${styles.wizardStepConnector} ${styles.wizardStepConnectorComplete}`
            : styles.wizardStepConnector;

        return (
          <div key={step.label} className={styles.wizardStepItem}>
            <div className={styles.wizardStepLead}>
              <span
                className={`${styles.wizardStepCircle} ${
                  isCompleted
                    ? styles.wizardStepComplete
                    : isActive
                      ? styles.wizardStepActive
                      : styles.wizardStepPending
                }`}
              >
                {isCompleted ? (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
                    <path
                      d="M3.5 8.5 6.5 11.5 12.5 5.5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  String(step.id)
                )}
              </span>
              <span
                className={`${styles.wizardStepLabel} ${
                  isPending ? styles.wizardStepLabelPending : ""
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 ? <span className={connectorClass} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function ShellStepSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className={styles.wizardSection}>
      <h4 className={styles.wizardSectionTitle}>{title}</h4>
      <div className={styles.wizardSectionBody}>{children}</div>
    </article>
  );
}

/**
 * Client-side wizard that orchestrates analysis and advisor response calls.
 */
export function WizardScaffold() {
  const locale = resolveRuntimeLocale();
  const t = (key: string) => tRuntime(key, locale);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [messageText, setMessageText] = useState("");
  const [mode, setMode] = useState<UsageMode>("reactive");
  const [quickMode, setQuickMode] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [advisorResult, setAdvisorResult] = useState<AdvisorResponse | null>(null);
  const [loadingAdvisor, setLoadingAdvisor] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [contextOptional, setContextOptional] = useState("");
  const [responseTone, setResponseTone] = useState<ResponseTone>("cordial");
  const [selectedProfile, setSelectedProfile] = useState<AdvisorProfile | null>(null);
  const [conversationBlocks, setConversationBlocks] = useState<ConversationBlock[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrInfo, setOcrInfo] = useState<OcrExtractResponse | null>(null);
  const [ocrStatusMessage, setOcrStatusMessage] = useState<string | null>(null);
  const [autoParsing, setAutoParsing] = useState(false);
  const [autoParseError, setAutoParseError] = useState<string | null>(null);
  const [ocrCapabilities, setOcrCapabilities] = useState<OcrCapabilitiesResponse | null>(null);
  const [ocrCapabilitiesLoading, setOcrCapabilitiesLoading] = useState(true);
  const [activeCase, setActiveCase] = useState<CaseSummary | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [incidentType, setIncidentType] = useState<IncidentType>("other");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [, setIncidentVisible] = useState(false);
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [, setIncidentNotice] = useState<string | null>(null);
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatDebugPayload, setAdvisorChatDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);
  const [speakingResponseIndex, setSpeakingResponseIndex] = useState<number | null>(null);
  const selectedCaseId = activeCase?.id ?? null;
  const manualInterpretTimerRef = useRef<number | null>(null);
  const conversationListRef = useRef<HTMLDivElement | null>(null);
  const sidebarConversationStartedAtRef = useRef<string | null>(null);
  const contextVoice = useSpeechToText({
    lang: "es-ES",
    continuous: false,
    interimResults: false,
  });
  const contextMicrophoneStatusMessage = getMicrophoneStatusMessage(
    contextVoice.microphoneStatus,
    contextVoice.speechSupported,
  );
  const speechSynthesis = useSpeechSynthesis({ lang: "es-ES" });

  useEffect(() => {
    let mounted = true;
    async function loadOcrCapabilities() {
      setOcrCapabilitiesLoading(true);
      try {
        const response = await authFetch(OCR_CAPABILITIES_URL, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as OcrCapabilitiesResponse;
        if (!mounted) return;
        setOcrCapabilities(payload);
      } catch {
        if (!mounted) return;
        setOcrCapabilities({
          available: false,
          selected_provider: "auto",
          providers_checked: [],
          reason_codes: ["ocr_unavailable"],
        });
      } finally {
        if (mounted) setOcrCapabilitiesLoading(false);
      }
    }
    void loadOcrCapabilities();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadCases() {
      setCaseError(null);
      try {
        const response = await getCases();
        if (!mounted) return;
        const defaultCase = response.cases[0] ?? null;
        setActiveCase(defaultCase);
        if (!defaultCase) {
          setCaseError("No se encontro contexto de caso para este usuario.");
        }
      } catch (exc) {
        if (!mounted) return;
        setCaseError(toUiErrorMessage(exc, "No se pudo cargar el contexto del caso."));
      }
    }
    void loadCases();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (manualInterpretTimerRef.current !== null) {
        window.clearTimeout(manualInterpretTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleExternalNewConversation() {
      handleStartNewConversation();
    }

    window.addEventListener("mvp:new-conversation", handleExternalNewConversation);
    return () => {
      window.removeEventListener("mvp:new-conversation", handleExternalNewConversation);
    };
  }, []);

  useEffect(() => {
    if (!contextVoice.transcript.trim()) return;
    setContextOptional((previous) =>
      previous.trim()
        ? `${previous.trim()}\n${contextVoice.transcript.trim()}`
        : contextVoice.transcript.trim(),
    );
    const wrapper = document.getElementById("wizard-context-optional-wrap");
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
      const input = document.getElementById("wizard-context-optional") as HTMLInputElement | null;
      input?.focus();
    }, 30);
    contextVoice.resetTranscript();
  }, [contextVoice]);

  useEffect(() => {
    if (currentStep !== 1) return;
    const container = conversationListRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [conversationBlocks, currentStep]);

  useEffect(() => {
    if (!speechSynthesis.speaking && speakingResponseIndex !== null) {
      setSpeakingResponseIndex(null);
    }
  }, [speakingResponseIndex, speechSynthesis.speaking]);

  function openAdvisorProfileById(advisorId: string) {
    const profile = ADVISOR_PROFILES.find((advisor) => advisor.id === advisorId) ?? null;
    setSelectedProfile(profile);
  }

  function buildContextPayload(additionalContext?: Record<string, unknown>) {
    const context: Record<string, unknown> = {};
    if (contextOptional.trim()) context.contact_context = contextOptional.trim();
    context.user_style = responseTone;
    const structuredConversation = formatConversationBlocksForContext(conversationBlocks);
    const latestExPartnerMessage = getLatestExPartnerMessage(conversationBlocks);
    if (structuredConversation) {
      context.conversation_structured = structuredConversation;
    }
    if (latestExPartnerMessage) {
      context.latest_ex_partner_message = latestExPartnerMessage;
    } else if (conversationBlocks.length === 0 && messageText.trim()) {
      context.latest_ex_partner_message = messageText.trim();
    }
    if (conversationBlocks.length > 0) {
      context.conversation_blocks = conversationBlocks.map((item) => ({
        speaker: item.speaker,
        content: item.content,
        confidence: item.confidence ?? null,
        source: item.source ?? "manual",
      }));
      context.conversation_history = conversationBlocks.map((item) => ({
        sender: mapConversationSpeakerToHistorySender(item.speaker),
        text: item.content,
        speaker: item.speaker,
      }));
    }
    if (additionalContext) {
      for (const [key, value] of Object.entries(additionalContext)) {
        if (value === undefined || value === null || value === "") continue;
        context[key] = value;
      }
    }
    return Object.keys(context).length > 0 ? context : undefined;
  }

  function syncConversationBlocks(blocks: ConversationBlock[]) {
    setConversationBlocks(blocks);
    const structuredText = formatConversationBlocksForContext(blocks);
    if (structuredText) {
      setMessageText(structuredText);
    }
  }

  function syncSidebarConversationSummary() {
    if (typeof window === "undefined") return;
    if (!sidebarConversationStartedAtRef.current) {
      sidebarConversationStartedAtRef.current = new Date().toISOString();
    }
    window.dispatchEvent(
      new CustomEvent("mvp:conversation-summary", {
        detail: {
          visible: true,
          title: buildSidebarConversationTitle(conversationBlocks, messageText),
          startedAt: sidebarConversationStartedAtRef.current,
        },
      }),
    );
  }

  async function interpretConversationText(
    rawText: string,
    source: "ocr" | "text",
  ) {
    const normalized = rawText.trim();
    if (!normalized) {
      setConversationBlocks([]);
      return;
    }
    setAutoParsing(true);
    setAutoParseError(null);
    try {
      const localFallback = heuristicSegmentConversation(
        normalized,
        source === "ocr" ? "ocr" : "manual",
      );
      const interpreted = await postOcrInterpret({ text: normalized, source });
      const normalizedSource: ConversationBlock["source"] = source === "ocr" ? "ocr" : "manual";
      const apiBlocks: ConversationBlock[] = interpreted.blocks
        .map((block) => ({
          id: block.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          speaker: block.speaker,
          content: block.content.trim(),
          confidence: typeof block.confidence === "number" ? block.confidence : undefined,
          source: normalizedSource,
        }))
        .filter((block) => block.content.length > 0);
      const legacyBlocks: ConversationBlock[] = !apiBlocks.length
        ? (interpreted.conversation_turns ?? [])
            .map((turn) =>
              createConversationBlock(
                turn.speaker === "me" ? "user" : "ex_partner",
                turn.text,
                source === "ocr" ? "ocr" : "manual",
              ),
            )
            .filter((block) => block.content.length > 0)
        : [];
      const resolvedBlocks = apiBlocks.length > 0 ? apiBlocks : legacyBlocks;
      if (resolvedBlocks.length > 0) {
        syncConversationBlocks(resolvedBlocks);
        return;
      }
      if (localFallback.length > 0) {
        syncConversationBlocks(localFallback);
      }
    } catch {
      const fallbackBlocks = heuristicSegmentConversation(
        normalized,
        source === "ocr" ? "ocr" : "manual",
      );
      if (fallbackBlocks.length > 0) {
        syncConversationBlocks(fallbackBlocks);
      }
      setAutoParseError(
        "No pudimos interpretar perfectamente todos los turnos. Revisa los bloques antes de generar la respuesta.",
      );
    } finally {
      setAutoParsing(false);
    }
  }

  async function handleExtractTextFromImage(file: File) {
    if (ocrLoading) return;
    if (!hasStoredSession()) {
      setOcrError("Tu sesion no esta activa. Inicia sesion para usar esta funcion.");
      return;
    }
    if (ocrCapabilitiesLoading || ocrCapabilities?.available === false) {
      setOcrError("Esta funcion no esta disponible en este entorno.");
      return;
    }

    setOcrLoading(true);
    setOcrError(null);
    setOcrInfo(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await authFetch(OCR_EXTRACT_URL, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as
          | { detail?: string; message?: string }
          | null;
        throw new Error(
          resolveOcrErrorMessage(errorPayload?.detail, errorPayload?.message),
        );
      }
      const payload = (await response.json()) as OcrExtractResponse;
      setMessageText(payload.extracted_text);
      setOcrInfo(payload);
      setOcrStatusMessage("Texto interpretado automaticamente.");
      if (payload.conversation_turns && payload.conversation_turns.length > 0) {
        const blocksFromOcr = payload.conversation_turns
          .map((turn) =>
            createConversationBlock(
              turn.speaker === "me" ? "user" : "ex_partner",
              turn.text,
              "ocr",
            ),
          )
          .filter((block) => block.content.length > 0);
        if (blocksFromOcr.length > 0) {
          syncConversationBlocks(blocksFromOcr);
        } else {
          await interpretConversationText(payload.extracted_text, "ocr");
        }
      } else {
        await interpretConversationText(payload.extracted_text, "ocr");
      }
    } catch (exc) {
      setOcrError(
        exc instanceof Error
          ? exc.message
          : "No se pudo leer el texto de la imagen.",
      );
    } finally {
      setOcrLoading(false);
    }
  }

  async function processImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setOcrError("Selecciona una imagen valida (PNG, JPG o WebP).");
      setOcrInfo(null);
      setOcrStatusMessage(null);
      return;
    }
    setOcrError(null);
    setOcrInfo(null);
    setOcrStatusMessage("Procesando captura...");
    await handleExtractTextFromImage(file);
  }

  function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    void processImageFile(file);
    event.target.value = "";
  }

  function handleStepOnePaste(event: ClipboardEvent<HTMLElement>) {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        void processImageFile(file);
      }
      return;
    }
    const pastedText = event.clipboardData.getData("text");
    if (pastedText && looksLikeConversationInput(pastedText)) {
      window.setTimeout(() => {
        void interpretConversationText(pastedText, "text");
      }, 0);
    }
  }

  function handleMessageTextChange(nextValue: string) {
    setMessageText(nextValue);
    if (manualInterpretTimerRef.current !== null) {
      window.clearTimeout(manualInterpretTimerRef.current);
      manualInterpretTimerRef.current = null;
    }
    if (!looksLikeConversationInput(nextValue)) {
      return;
    }
    manualInterpretTimerRef.current = window.setTimeout(() => {
      void interpretConversationText(nextValue, "text");
    }, 450);
  }

  function updateConversationBlockSpeaker(
    blockId: string,
    speaker: ConversationBlock["speaker"],
  ) {
    const updated = conversationBlocks.map((block) =>
      block.id === blockId ? { ...block, speaker } : block,
    );
    syncConversationBlocks(updated);
  }

  function updateConversationBlockText(blockId: string, content: string) {
    const updated = conversationBlocks.map((block) =>
      block.id === blockId ? { ...block, content } : block,
    );
    syncConversationBlocks(updated);
  }

  async function runAnalysis() {
    const text = getConversationSubmissionText(conversationBlocks, messageText);
    if (!text || loadingAnalysis) return;
    const sourceType = ocrInfo ? "ocr" : "text";

    setLoadingAnalysis(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setAnalysisId(null);

    try {
      const result = await postAnalysis({
        message_text: text,
        mode,
        relationship_type: "otro",
        case_id: selectedCaseId ?? undefined,
        source_type: sourceType,
        quick_mode: quickMode,
        context: buildContextPayload(),
      });
      setAnalysisResult(result);
      setAnalysisId(result.analysis_id);
    } catch (exc) {
      setAnalysisError(toUiErrorMessage(exc, "No se pudo ejecutar el analisis."));
    } finally {
      setLoadingAnalysis(false);
    }
  }

  async function requestAdvisor(params: { quickMode: boolean; analysisId?: string | null }) {
    const text = getConversationSubmissionText(conversationBlocks, messageText);
    if (!text || loadingAdvisor) return;
    const sourceType = ocrInfo ? "ocr" : "text";

    syncSidebarConversationSummary();
    setLoadingAdvisor(true);
    setAdvisorError(null);
    setAdvisorResult(null);
    setCopiedIndex(null);

    try {
      const result = await postAdvisor({
        message_text: text,
        mode,
        relationship_type: "otro",
        case_id: selectedCaseId ?? undefined,
        source_type: sourceType,
        quick_mode: params.quickMode,
        save_session: true,
        analysis_id: params.analysisId ?? undefined,
        context: buildContextPayload(),
      });
      setAdvisorResult(result);
      setCurrentStep(3);
    } catch (exc) {
      setAdvisorError(toUiErrorMessage(exc, "No se pudo generar respuestas de advisor."));
    } finally {
      setLoadingAdvisor(false);
    }
  }

  async function handleQuickResponse() {
    setAnalysisError(null);
    await requestAdvisor({ quickMode: true });
  }

  async function handleContinueFromStep1() {
    if (!messageText.trim() && conversationBlocks.length === 0) return;
    setAnalysisResult(null);
    setAnalysisId(null);
    setAnalysisError(null);
    setCurrentStep(2);
    await runAnalysis();
  }

  async function handleContinueToStep3() {
    if (!analysisId) return;
    await requestAdvisor({ quickMode: false, analysisId });
  }

  function handleStartNewConversation() {
    setCurrentStep(1);
    setMessageText("");
    setContextOptional("");
    setMode("reactive");
    setQuickMode(false);
    setAnalysisResult(null);
    setAnalysisId(null);
    setAnalysisError(null);
    setAdvisorResult(null);
    setAdvisorError(null);
    setCopiedIndex(null);
    setOcrInfo(null);
    setOcrError(null);
    setOcrStatusMessage(null);
    setOcrLoading(false);
    setConversationBlocks([]);
    setAutoParsing(false);
    setAutoParseError(null);
    setResponseTone("cordial");
    sidebarConversationStartedAtRef.current = null;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("mvp:conversation-summary", {
          detail: { visible: false },
        }),
      );
    }
  }

  function suggestIncidentType(): IncidentType {
    if (!analysisResult) return "other";
    const riskCodes = new Set(analysisResult.risk_flags.map((item) => item.code));
    if (riskCodes.has("high_emotion") || riskCodes.has("passive_aggressive")) {
      return "hostile_message";
    }
    if (riskCodes.has("urgency_conflict")) {
      return "schedule_change";
    }
    return "other";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function openIncidentCapture() {
    setIncidentVisible(true);
    setIncidentNotice(null);
    setIncidentType(suggestIncidentType());
    if (!incidentTitle.trim()) {
      setIncidentTitle("Evento relevante en la conversacion");
    }
    if (!incidentDescription.trim()) {
      const preview = messageText.trim().slice(0, 280);
      setIncidentDescription(preview ? `Contexto: ${preview}` : "");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleRegisterIncident() {
    if (!selectedCaseId) {
      setIncidentNotice("Necesitas contexto de caso para registrar el evento.");
      return;
    }
    const normalizedTitle = incidentTitle.trim();
    if (!normalizedTitle || incidentSaving) return;
    setIncidentSaving(true);
    setIncidentNotice(null);
    try {
      await postIncident({
        case_id: selectedCaseId,
        incident_type: incidentType,
        title: normalizedTitle,
        description: incidentDescription.trim(),
        source_type: "wizard",
        related_analysis_id: analysisId ?? undefined,
        related_session_id: advisorResult?.session_id ?? undefined,
        incident_date: incidentDate,
      });
      setIncidentNotice("Evento registrado en el contexto actual.");
      setIncidentVisible(false);
      setIncidentTitle("");
      setIncidentDescription("");
    } catch (exc) {
      setIncidentNotice(toUiErrorMessage(exc, "No se pudo registrar el evento."));
    } finally {
      setIncidentSaving(false);
    }
  }

  function openAdvisorChat(index: number) {
    if (!advisorResult?.responses[index]?.text) return;
    setAdvisorChatIndex(index);
    setAdvisorChatDebugPayload(null);
    setAdvisorChatMessages([
      {
        id: `advisor-initial-${index}`,
        role: "advisor",
        text: advisorResult.responses[index]!.text,
      },
    ]);
    setAdvisorChatInput("");
    setAdvisorChatOpen(true);
  }

  async function handleSendAdvisorRefinement() {
    if (advisorChatIndex === null || !advisorResult || advisorChatSending) return;
    const instruction = advisorChatInput.trim();
    if (!instruction) return;
    const baseText = advisorResult.responses[advisorChatIndex]?.text ?? "";
    if (!baseText) return;

    setAdvisorChatSending(true);
    try {
      const advisorVisual = getAdvisorVisualByIndex(advisorChatIndex);
      const contextualPayload = buildContextPayload({
        entry_mode: "advisor_refine_response",
        selected_advisor_id: advisorVisual.id,
        selected_advisor_name: advisorVisual.name,
        selected_advisor_role: advisorVisual.role,
        refinement_base_text: baseText,
      });
      const advisorPayload = {
        advisor_id: advisorVisual.id,
        entry_mode: "advisor_refine_response" as const,
        messages: [
          ...advisorChatMessages.map((item) => ({
            role: item.role,
            content: item.text,
          })),
          {
            role: "user" as const,
            content: instruction,
          },
        ],
        case_id: selectedCaseId ?? undefined,
        base_reply: baseText,
        conversation_context: {
          relationship_type: "otro",
          extra: contextualPayload ?? null,
        },
        debug: process.env.NODE_ENV !== "production",
      };
      if (process.env.NODE_ENV !== "production") {
        const debugPayload = {
          endpoint: "/v1/advisor/chat",
          entryMode: "advisor_refine_response",
          advisor: {
            id: advisorVisual.id,
            name: advisorVisual.name,
            role: advisorVisual.role,
          },
          userInput: instruction,
          payload: advisorPayload,
        };
        setAdvisorChatDebugPayload(debugPayload);
        console.debug("advisor_prompt_debug", debugPayload);
      }
      const result = await postAdvisorChat(advisorPayload);
      const refinedText = result.suggested_reply?.trim() || baseText;
      const advisorMessage = result.message.trim() || "Te propongo este ajuste.";
      setAdvisorResult((previous) => {
        if (!previous) return previous;
        const nextResponses = [...previous.responses];
        if (!nextResponses[advisorChatIndex]) return previous;
        nextResponses[advisorChatIndex] = {
          ...nextResponses[advisorChatIndex],
          text: refinedText,
        };
        return { ...previous, responses: nextResponses };
      });
      setAdvisorChatMessages((previous) => [
        ...previous,
        { id: `u-${Date.now()}`, role: "user", text: instruction },
        { id: `a-${Date.now() + 1}`, role: "advisor", text: advisorMessage },
      ]);
      setAdvisorChatInput("");
      if (process.env.NODE_ENV !== "production") {
        setAdvisorChatDebugPayload((previous) => ({
          ...(previous ?? {}),
          prompt: result.debug?.system_prompt ?? null,
          model_payload: result.debug?.user_payload ?? null,
          response_preview: refinedText.slice(0, 500),
          advisor_message_preview: advisorMessage.slice(0, 500),
          context_structured: contextualPayload ?? null,
        }));
      }
    } catch (exc) {
      setAdvisorError(toUiErrorMessage(exc, "No se pudo refinar la respuesta de este adviser."));
    } finally {
      setAdvisorChatSending(false);
    }
  }

  function handleVoiceRefinementSessionSync(payload: {
    turns: Array<{ role: "user" | "advisor"; text: string }>;
    lastSuggestedReply: string | null;
    debug?: Record<string, unknown> | null;
  }) {
    if (advisorChatIndex === null || payload.turns.length === 0) return;
    const newTurns = payload.turns.map((turn, index) => ({
      id: `v-sync-${Date.now()}-${index}`,
      role: turn.role,
      text: turn.text,
    }));
    setAdvisorChatMessages((previous) => [...previous, ...newTurns]);
    if (payload.lastSuggestedReply?.trim()) {
      setAdvisorResult((previous) => {
        if (!previous) return previous;
        const nextResponses = [...previous.responses];
        if (!nextResponses[advisorChatIndex]) return previous;
        nextResponses[advisorChatIndex] = {
          ...nextResponses[advisorChatIndex],
          text: payload.lastSuggestedReply!.trim(),
        };
        return { ...previous, responses: nextResponses };
      });
    }
    if (process.env.NODE_ENV !== "production") {
      setAdvisorChatDebugPayload((previous) => ({
        ...(previous ?? {}),
        voice_response: payload,
        endpoint: "/v1/advisor/voice",
      }));
    }
  }

  async function handleCopy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      const sessionId = advisorResult?.session_id;
      const advisorId = getAdvisorVisualByIndex(index).id;
      if (sessionId) {
        void postWizardEvent({
          event_name: "reply_copied",
          session_id: sessionId,
          analysis_id: analysisId ?? undefined,
          advisor_id: advisorId,
          response_index: index,
        }).catch(() => {
          // Keep UX resilient if analytics persistence fails.
        });
      }
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setAdvisorError("No se pudo copiar la respuesta.");
    }
  }

  function handleToggleSpeakResponse(index: number, text: string) {
    if (!speechSynthesis.supported || !text.trim()) return;
    if (speechSynthesis.speaking && speakingResponseIndex === index) {
      speechSynthesis.stop();
      setSpeakingResponseIndex(null);
      return;
    }
    speechSynthesis.speak(text);
    setSpeakingResponseIndex(index);
  }

  const analysisStatus = analysisResult ? getAnalysisStatus(analysisResult) : null;
  const riskMeter = analysisResult ? getRiskMeter(analysisResult) : null;
  const analysisQuickChips = analysisResult ? getAnalysisQuickChips(analysisResult) : [];
  const hasConversationInput = messageText.trim().length > 0 || conversationBlocks.length > 0;

  return (
    <Panel className={styles.wizardPanel}>
      <ShellStepper
        currentStep={currentStep}
        labels={[
          t("wizard.step.intake"),
          t("wizard.step.analysis"),
          t("wizard.step.responses"),
        ]}
      />

      {currentStep === 1 ? (
        <div className={styles.wizardStepBody}>
          <div className={styles.wizardStepHeader}>
            <h3 className={styles.wizardStepIntroTitle}>Sube, pega o escribe la conversacion.</h3>
            {caseError ? <p className="mt-2 text-xs text-red-700">{caseError}</p> : null}
          </div>

          <div className={styles.wizardStepOneGrid}>
            <section
              className={`${styles.wizardStepPanel} ${styles.wizardComposerPanel}`}
              onPaste={handleStepOnePaste}
            >
              <div className={styles.wizardInputGroup}>
                <div className={styles.wizardPanelTitleRow}>
                  <h4 className={styles.wizardPanelTitle}>Conversacion</h4>
                  {hasConversationInput ? (
                    <button
                      type="button"
                      onClick={handleStartNewConversation}
                      title="Limpiar conversacion"
                      aria-label="Limpiar conversacion"
                      className={styles.wizardIconButton}
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                        <path
                          d="M6 6l8 8M14 6l-8 8"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.8"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
                <Textarea
                  value={messageText}
                  onChange={(event) => handleMessageTextChange(event.target.value)}
                  rows={6}
                  placeholder="Pega aqui el mensaje que recibiste o copia la conversacion de WhatsApp"
                  spellCheck={false}
                  className={styles.wizardPrimaryTextarea}
                />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelection}
                  disabled={ocrCapabilities?.available === false || ocrCapabilitiesLoading}
                  className="hidden"
                  id="wizard-file-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById("wizard-file-input") as HTMLInputElement | null;
                    input?.click();
                  }}
                  disabled={ocrCapabilities?.available === false || ocrCapabilitiesLoading}
                  className={styles.wizardAttachButton}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                    <path
                      d="M7.5 10.5 11 7a2.5 2.5 0 1 1 3.536 3.536l-5.657 5.657A4 4 0 1 1 3.222 10.536L9.586 4.17"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                    />
                  </svg>
                  Adjuntar conversacion
                </button>
                {ocrCapabilities?.available === false ? (
                  <p className="text-xs text-amber-700">
                    OCR no disponible: {resolveOcrErrorMessage(ocrCapabilities.reason_codes[0])}
                  </p>
                ) : null}
                {ocrLoading || autoParsing ? (
                  <p className={styles.wizardStepStatus}>Detectando participantes e interpretando contexto...</p>
                ) : null}
                {ocrStatusMessage ? (
                  <p className={styles.wizardPanelHint}>
                    {ocrStatusMessage}
                    {ocrInfo?.provider ? ` (${ocrInfo.provider})` : ""}
                  </p>
                ) : null}
                {ocrError ? <p className="text-xs text-red-700">{ocrError}</p> : null}
                {autoParseError ? <p className="text-xs text-amber-700">{autoParseError}</p> : null}
              </div>

              <div className={styles.wizardInputGroup}>
                <div id="wizard-context-optional-wrap" className="rounded-xl transition-all duration-200">
                  <div className={styles.wizardContextRow}>
                    <input
                      id="wizard-context-optional"
                      type="text"
                      value={contextOptional}
                      onChange={(event) => setContextOptional(event.target.value)}
                      placeholder="Contanos el contexto para entender mejor"
                      spellCheck={false}
                      className={styles.wizardContextInput}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (contextVoice.listening) {
                          contextVoice.stopListening();
                        } else {
                          contextVoice.startListening();
                        }
                      }}
                      disabled={contextVoice.microphoneStatus === "requesting"}
                      className={`${styles.wizardVoiceMic} ${
                        contextVoice.listening ? styles.wizardVoiceMicActive : ""
                      }`}
                      aria-label={contextVoice.listening ? "Escuchando contexto" : "Dictar contexto"}
                      title={contextVoice.listening ? "Escuchando contexto" : "Dictar contexto"}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none">
                        <path
                          d="M12 3.75a2.75 2.75 0 0 0-2.75 2.75v4.75a2.75 2.75 0 1 0 5.5 0V6.5A2.75 2.75 0 0 0 12 3.75Z"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.85"
                        />
                        <path
                          d="M6.75 10.75a5.25 5.25 0 1 0 10.5 0M12 16v4.25M9.25 20.25h5.5"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.85"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                {contextMicrophoneStatusMessage ? (
                  <p className={styles.wizardPanelHint}>{contextMicrophoneStatusMessage}</p>
                ) : null}
                {contextVoice.error ? (
                  <p className="text-[12px] text-[#92400e]">{getSpeechToTextErrorMessage(contextVoice.error)}</p>
                ) : null}
              </div>
            </section>

            <section className={`${styles.wizardStepPanel} ${styles.wizardReviewPanel}`}>
              <div className={styles.wizardInterpretedFrame}>
                <div className={styles.wizardPanelTitleRow}>
                  <div>
                    <h4 className={styles.wizardPanelTitle}>Conversacion interpretada</h4>
                    <p className={styles.wizardPanelHint}>
                      Revisa quien dijo cada mensaje antes de generar la respuesta.
                    </p>
                  </div>
                </div>

                <div ref={conversationListRef} className={styles.wizardConversationList}>
                  {conversationBlocks.length === 0 ? (
                    <p className={styles.wizardEmptyState}>
                      Cuando detectemos una conversacion, aparecera aqui en bloques editables.
                    </p>
                  ) : null}
                  {conversationBlocks.map((item) => (
                    <div
                      key={item.id}
                      className={`${styles.wizardBubble} ${
                        item.speaker === "ex_partner"
                          ? styles.wizardBubbleIncoming
                          : item.speaker === "user"
                            ? styles.wizardBubbleOutgoing
                            : styles.wizardBubbleUnknown
                      }`}
                    >
                      <div className={`${styles.wizardSpeakerSwitch} mb-2`}>
                        <button
                          type="button"
                          onClick={() => updateConversationBlockSpeaker(item.id, "ex_partner")}
                          className={`${styles.wizardSpeakerOption} ${
                            item.speaker === "ex_partner"
                              ? styles.wizardSpeakerOptionActiveIncoming
                              : ""
                          }`}
                        >
                          Ex pareja
                        </button>
                        <button
                          type="button"
                          onClick={() => updateConversationBlockSpeaker(item.id, "unknown")}
                          className={`${styles.wizardSpeakerOption} ${
                            item.speaker === "unknown"
                              ? styles.wizardSpeakerOptionActiveUnknown
                              : ""
                          }`}
                        >
                          Sin identificar
                        </button>
                        <button
                          type="button"
                          onClick={() => updateConversationBlockSpeaker(item.id, "user")}
                          className={`${styles.wizardSpeakerOption} ${
                            item.speaker === "user"
                              ? styles.wizardSpeakerOptionActiveOutgoing
                              : ""
                          }`}
                        >
                          Yo
                        </button>
                      </div>
                      <Textarea
                        value={item.content}
                        onChange={(event) => updateConversationBlockText(item.id, event.target.value)}
                        rows={Math.max(2, Math.ceil(item.content.length / 42))}
                        spellCheck={false}
                        className={styles.wizardBubbleTextarea}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className={styles.wizardStepActions}>
            <div className={styles.wizardActionGroup} />
            <div className={styles.wizardActionGroup}>
              <Button
                type="button"
                onClick={handleContinueFromStep1}
                disabled={(!messageText.trim() && conversationBlocks.length === 0) || loadingAnalysis}
                variant="primary"
                className={`${styles.wizardPrimaryButton} h-10 text-[13px] hover:bg-[#265cc7]`}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                  <path
                    d="M4 10h12M10 4l6 6-6 6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                {loadingAnalysis ? t("wizard.button.analyzing") : "Ver Analisis"}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setQuickMode(true);
                  void handleQuickResponse();
                }}
                disabled={(!messageText.trim() && conversationBlocks.length === 0) || loadingAdvisor}
                variant="secondary"
                className={`${styles.wizardSecondaryButton} h-10 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                  <path
                    d="m10 3 1.8 4.7L17 9l-4 3.2L14.3 17 10 14.2 5.7 17 7 12.2 3 9l5.2-1.3L10 3Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.4"
                  />
                </svg>
                {loadingAdvisor ? t("wizard.button.generating") : "Ver Sugerencias"}
              </Button>
            </div>
          </div>
          {advisorError ? <p className="mt-2 text-sm text-red-700">{advisorError}</p> : null}
        </div>
      ) : null}
      {currentStep === 2 ? (
        <div className={styles.wizardStepBody}>
          <div className={styles.wizardStepHeader}>
            <h3 className={styles.wizardStepIntroTitle}>Paso 2: Analisis</h3>
            <p className={styles.wizardStepIntroCopy}>
              Revisamos el tono general antes de generar las respuestas.
            </p>
          </div>

          <div className="min-h-6">
            {loadingAnalysis ? (
              <p className={styles.wizardStepStatus}>Interpretando contexto...</p>
            ) : null}
            {analysisError ? <p className="text-sm text-red-700">{analysisError}</p> : null}
            {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
          </div>

          {analysisResult ? (
            <>
              <div className={styles.wizardAnalysisHero}>
                <section className={styles.wizardAnalysisHeroCard}>
                  <div
                    className={`${styles.wizardAnalysisBanner} ${
                      analysisStatus?.kind === "ok"
                        ? styles.wizardAnalysisBannerOk
                        : styles.wizardAnalysisBannerRisk
                    }`}
                  >
                    <span className={styles.wizardAnalysisIcon}>
                      {analysisStatus?.kind === "ok" ? (
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                          <path
                            d="M4.5 10.5 8 14l7.5-8"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                          <path
                            d="M10 3.5 17 16.5H3L10 3.5Zm0 4v4m0 2.5h.01"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.8"
                          />
                        </svg>
                      )}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">
                        {analysisStatus?.kind === "risk"
                          ? "Atencion: "
                          : analysisStatus?.kind === "observation"
                            ? "Observacion: "
                            : ""}
                        {analysisStatus?.title}
                      </p>
                      <p className="mt-1 text-sm">{analysisStatus?.description}</p>
                    </div>
                  </div>

                  <div className={styles.wizardAnalysisSummary}>
                    <p className={styles.wizardAnalysisSummaryLabel}>Sintesis</p>
                    <p className={styles.wizardAnalysisSummaryText}>{analysisResult.summary}</p>
                  </div>

                  {analysisResult.emotional_context.intent_guess ? (
                    <div className={styles.wizardInsightRow}>
                      <span className={styles.wizardInsightIcon}>
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                          <path
                            d="M10 3.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5Zm0 4v.25m0 1.75v3.5"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.7"
                          />
                        </svg>
                      </span>
                      <p>
                        Objetivo sugerido: <strong>{analysisResult.emotional_context.intent_guess}</strong>
                      </p>
                    </div>
                  ) : null}
                </section>

                <aside className={styles.wizardAnalysisMetaCard}>
                  {riskMeter ? (
                    <div className={styles.wizardRiskMeter}>
                      <div className={styles.wizardRiskMeterHead}>
                        <p className={styles.wizardRiskMeterLabel}>Nivel de riesgo</p>
                        <span className={styles.wizardRiskMeterValue}>
                          {riskMeter.level === "high"
                            ? "Alto"
                            : riskMeter.level === "medium"
                              ? "Medio"
                              : "Bajo"}
                        </span>
                      </div>
                      <div className={styles.wizardRiskMeterTrack}>
                        <div
                          className={`${styles.wizardRiskMeterFill} ${
                            riskMeter.level === "high"
                              ? styles.wizardRiskMeterHigh
                              : riskMeter.level === "medium"
                                ? styles.wizardRiskMeterMedium
                                : styles.wizardRiskMeterLow
                          }`}
                          style={{ width: `${riskMeter.value}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {analysisQuickChips.length > 0 ? (
                    <div className={styles.wizardAnalysisQuickChips}>
                      {analysisQuickChips.map((chip) => (
                        <span key={chip.label} className={styles.wizardAnalysisChip}>
                          <span className={styles.wizardAnalysisChipLabel}>{chip.label}</span>
                          <span>{chip.value}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </aside>
              </div>

              <div className={`${styles.wizardCardsGrid} ${styles.wizardAnalysisGrid}`}>
                <ShellStepSection title="Contexto emocional">
                  <p>
                    <span className="font-medium text-white/85">Tono detectado:</span>{" "}
                    {analysisResult.emotional_context.tone || "no disponible"}.
                  </p>
                  <p>
                    <span className="font-medium text-white/85">Objetivo sugerido:</span>{" "}
                    {analysisResult.emotional_context.intent_guess || "sin sugerencia clara"}.
                  </p>
                </ShellStepSection>

                <ShellStepSection title="Riesgos">
                  {analysisResult.risk_flags.length === 0 ? (
                    <p>No detectamos senales de riesgo.</p>
                  ) : (
                    <ul className="space-y-1">
                      {analysisResult.risk_flags.map((flag) => (
                        <li key={`${flag.code}-${flag.severity}`} className="break-words">
                          {humanizeFlag(flag)}
                        </li>
                      ))}
                    </ul>
                  )}
                </ShellStepSection>

                <ShellStepSection title="Alertas">
                  {analysisResult.ui_alerts.length === 0 ? (
                    <p>No hay alertas relevantes.</p>
                  ) : (
                    <ul className="space-y-1">
                      {analysisResult.ui_alerts.map((alert, index) => (
                        <li key={`${alert.level}-${index}`} className="break-words">
                          {alert.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </ShellStepSection>
              </div>

              <div className={styles.wizardFooterRow}>
                <Button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  variant="secondary"
                  className={`${styles.wizardSecondaryButton} h-10 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                    <path
                      d="M16 10H4m6 6-6-6 6-6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                  Volver
                </Button>
                <div className={styles.wizardFooterSpacer} />
                <Button
                  type="button"
                  onClick={handleContinueToStep3}
                  disabled={!analysisId || loadingAdvisor}
                  variant="primary"
                  className={`${styles.wizardPrimaryButton} h-10 min-w-[150px] text-[13px] hover:bg-[#265cc7]`}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                    <path
                      d="M4 10h12M10 4l6 6-6 6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                  {loadingAdvisor ? t("wizard.button.generating") : t("wizard.button.continue")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {currentStep === 3 ? (
        <div className={styles.wizardStepBody}>
          <div className={styles.wizardStepHeader}>
            <h3 className={styles.wizardStepIntroTitle}>Paso 3: Respuestas</h3>
            <p className={styles.wizardStepIntroCopy}>
              Elige la variante que mejor encaja con tu objetivo.
            </p>
          </div>

          <div className="min-h-6">
            {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
            {loadingAdvisor ? (
              <p className={styles.wizardStepStatus}>Generando respuestas...</p>
            ) : null}
          </div>

          <div className={`${styles.wizardCardsGrid} ${styles.wizardAdvisorCards}`}>
            {Array.from({ length: 3 }).map((_, index) => {
              const advisorVisual = getAdvisorVisualByIndex(index);
              const advisorAvatar64 = getAdvisorAvatar(advisorVisual, "64");
              const response = advisorResult?.responses[index];
              const responseText = response?.text ?? "";
              const isRecommended = index === 0;
              const advisorInitials = advisorVisual.name
                .split(" ")
                .filter((part) => part.trim().length > 0)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() ?? "")
                .join("");

              return (
                <article
                  key={`${advisorVisual.id}-${index}`}
                  onClick={() => openAdvisorChat(index)}
                  className={`${styles.wizardAdvisorCard} ${
                    isRecommended ? styles.wizardAdvisorCardRecommended : ""
                  }`}
                >
                  <header
                    className={`${styles.wizardAdvisorHeader} ${
                      isRecommended ? styles.wizardAdvisorHeaderRecommended : ""
                    }`}
                  >
                    {isRecommended ? (
                      <span className={styles.wizardAdvisorRecommendedTag}>
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                          <path
                            d="m8 2 1.55 3.49L13 6l-2.6 2.28.73 3.22L8 9.9l-3.13 1.6.73-3.22L3 6l3.45-.51L8 2Z"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.3"
                          />
                        </svg>
                        Recomendada
                      </span>
                    ) : null}
                    <span className={styles.wizardAdvisorBadge}>
                      {getResponseBadgeLabel(response?.emotion_label)}
                    </span>
                    <div className={styles.wizardAdvisorHeaderRow}>
                      <div className="flex min-w-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openAdvisorProfileById(advisorVisual.id);
                          }}
                          className={styles.wizardAdvisorAvatarButton}
                          aria-label={`Abrir perfil de ${advisorVisual.name}`}
                        >
                          {advisorAvatar64 ? (
                            <Image
                              src={advisorAvatar64}
                              alt={advisorVisual.name}
                              width={46}
                              height={46}
                              className={styles.wizardAdvisorAvatar}
                            />
                          ) : (
                            <span className={styles.wizardAdvisorAvatarFallback}>
                              {advisorInitials || "AD"}
                            </span>
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className={`${styles.wizardAdvisorName} truncate`}>{advisorVisual.name}</p>
                          <p className={`${styles.wizardAdvisorRole} truncate`}>{advisorVisual.role}</p>
                        </div>
                      </div>
                    </div>
                  </header>

                  <p className={styles.wizardAdvisorResponse}>
                    {responseText || "Sin respuesta disponible."}
                  </p>

                  <div className={styles.wizardAdvisorActions}>
                    {speechSynthesis.supported ? (
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleSpeakResponse(index, responseText);
                        }}
                        disabled={!responseText}
                        variant="secondary"
                        className={`${styles.wizardTertiaryButton} h-9 text-[13px] hover:bg-[rgba(255,255,255,0.1)]`}
                      >
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                          <path
                            d="M4.5 11.5h2.75L11 14.5v-9L7.25 8.5H4.5v3Zm9.75-3.75a4.25 4.25 0 0 1 0 4.5m1.75-6.5a6.75 6.75 0 0 1 0 8.5"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.6"
                          />
                        </svg>
                        {speechSynthesis.speaking && speakingResponseIndex === index ? "Detener" : "Escuchar"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAdvisorChat(index);
                      }}
                      disabled={!responseText}
                      variant="secondary"
                      className={`${styles.wizardSecondaryButton} h-9 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-[#ef4444]" fill="none">
                        <path
                          d="M10 3.75a2.5 2.5 0 0 0-2.5 2.5v4.25a2.5 2.5 0 1 0 5 0V6.25A2.5 2.5 0 0 0 10 3.75Zm-4.25 6.5a4.25 4.25 0 1 0 8.5 0M10 14.5v2.25m-2 0h4"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                      </svg>
                      Conversar
                    </Button>
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCopy(responseText, index);
                      }}
                      disabled={!responseText}
                      variant="primary"
                      className={`h-9 rounded-[8px] px-4 text-[13px] ${
                        copiedIndex === index
                          ? "bg-[#16A34A] text-white hover:bg-[#15803d]"
                          : `${styles.wizardPrimaryButton} hover:bg-[#265cc7]`
                      }`}
                    >
                      {copiedIndex !== index ? (
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                          <path
                            d="M7.5 6.5h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm-2 3h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.8"
                          />
                        </svg>
                      ) : null}
                      {copiedIndex === index ? "Respuesta copiada" : "Usar esta respuesta"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.wizardFooterRow}>
            <div className={styles.wizardActionGroup}>
              <Button
                type="button"
                onClick={() => setCurrentStep(2)}
                variant="secondary"
                className={`${styles.wizardSecondaryButton} h-10 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                  <path
                    d="M16 10H4m6 6-6-6 6-6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                Volver al paso 2
              </Button>
            </div>
            <div className={styles.wizardFooterSpacer} />
            <div className={styles.wizardActionGroup}>
              <Button
                type="button"
                onClick={() => setCurrentStep(1)}
                variant="secondary"
                className={`${styles.wizardMutedButton} h-10 px-3 text-[12px] hover:bg-[rgba(255,255,255,0.08)]`}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                  <path
                    d="M10 5.5v4.5m0 0 3 3m-3-3-3 3M4.75 10a5.25 5.25 0 1 1 10.5 0 5.25 5.25 0 0 1-10.5 0Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.6"
                  />
                </svg>
                Ninguna me sirve / quiero agregar mas contexto
              </Button>
              <Button
                type="button"
                onClick={handleStartNewConversation}
                variant="primary"
                className={`${styles.wizardPrimaryButton} h-10 text-[13px] hover:bg-[#265cc7]`}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                  <path
                    d="M10 4v12M4 10h12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
                Iniciar nueva conversacion
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <AdvisorChatModal
        isOpen={advisorChatOpen}
        advisorId={advisorChatIndex !== null ? getAdvisorVisualByIndex(advisorChatIndex).id : undefined}
        advisorName={advisorChatIndex !== null ? getAdvisorVisualByIndex(advisorChatIndex).name : "Adviser"}
        advisorRole={advisorChatIndex !== null ? getAdvisorVisualByIndex(advisorChatIndex).role : ""}
        advisorDescription={
          advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.description ?? "" : ""
        }
        advisorAvatarSrc={
          advisorChatIndex !== null
            ? getAdvisorAvatar(getAdvisorVisualByIndex(advisorChatIndex), "128")
            : null
        }
        caseId={selectedCaseId}
        messages={advisorChatMessages}
        draft={advisorChatInput}
        sending={advisorChatSending}
        entryMode="advisor_refine_response"
        helperCopy="Que te parecio mi sugerencia? Puedes darme mas contexto y la ajustamos juntos."
        debugPayload={advisorChatDebugPayload}
        onDraftChange={setAdvisorChatInput}
        onSend={() => void handleSendAdvisorRefinement()}
        onVoiceSessionSync={handleVoiceRefinementSessionSync}
        onUseResponse={() => setAdvisorChatOpen(false)}
        onClose={() => setAdvisorChatOpen(false)}
      />
      <AdvisorProfileModal profile={selectedProfile} onClose={() => setSelectedProfile(null)} />
    </Panel>
  );
}


