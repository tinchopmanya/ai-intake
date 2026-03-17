"use client";

import { type ChangeEvent, type ClipboardEvent, useEffect, useRef, useState } from "react";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import { VoiceListeningBadge, VoiceMicButton, VoicePlaybackButton } from "@/components/mvp/VoiceControls";
import { Button, Panel, Select, Textarea } from "@/components/mvp/ui";
import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { authFetch } from "@/lib/auth/client";
import { hasStoredSession } from "@/lib/auth/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import {
  getCases,
  postAdvisor,
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
};

const responseStyleBadgeByIndex = ["Empatica", "Estrategica", "Directa"] as const;
const responseStyleOptions = [
  { value: "cordial", label: "Cordial" },
  { value: "firme_respetuoso", label: "Firme pero respetuoso" },
  { value: "amigable", label: "Amigable" },
] as const;

type ResponseTone = (typeof responseStyleOptions)[number]["value"];

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

const INCIDENT_TYPE_OPTIONS: Array<{ value: IncidentType; label: string }> = [
  { value: "schedule_change", label: "Cambio de horario" },
  { value: "cancellation", label: "Cancelacion" },
  { value: "payment_issue", label: "Tema de pago" },
  { value: "hostile_message", label: "Mensaje hostil" },
  { value: "documentation", label: "Documentacion" },
  { value: "other", label: "Otro evento" },
];

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
    let speaker = currentSpeaker;
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

function humanizeFlag(flag: AnalysisRiskFlag) {
  const label =
    RISK_LABELS[flag.code] ??
    flag.code
      .replaceAll("_", " ")
      .replace(/\b\w/g, (match) => match.toUpperCase());
  return `${label} (${SEVERITY_LABELS[flag.severity]})`;
}

/**
 * Visual step indicator for intake, analysis and response stages.
 */
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
              <span
                className={`h-px min-w-[12px] flex-1 ${
                  currentStep > step.id ? "bg-emerald-300" : "bg-gray-300"
                }`}
              />
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

/**
 * Client-side wizard that orchestrates analysis and advisor response calls.
 */
export function WizardScaffold() {
  const isDevelopment = process.env.NODE_ENV !== "production";
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
  const [incidentDate, setIncidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [incidentVisible, setIncidentVisible] = useState(false);
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [incidentNotice, setIncidentNotice] = useState<string | null>(null);
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);
  const [speakingResponseIndex, setSpeakingResponseIndex] = useState<number | null>(null);
  const selectedCaseId = activeCase?.id ?? null;
  const manualInterpretTimerRef = useRef<number | null>(null);
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
      const input = document.getElementById("wizard-context-optional") as HTMLTextAreaElement | null;
      input?.focus();
    }, 30);
    contextVoice.resetTranscript();
  }, [contextVoice]);

  useEffect(() => {
    if (!speechSynthesis.speaking && speakingResponseIndex !== null) {
      setSpeakingResponseIndex(null);
    }
  }, [speakingResponseIndex, speechSynthesis.speaking]);

  function openAdvisorProfileById(advisorId: string) {
    const profile = ADVISOR_PROFILES.find((advisor) => advisor.id === advisorId) ?? null;
    setSelectedProfile(profile);
  }

  function buildContextPayload() {
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
    } else if (messageText.trim()) {
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
        sender: item.speaker === "user" ? "outgoing" : "incoming",
        text: item.content,
      }));
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
      const apiBlocks: ConversationBlock[] = interpreted.blocks
        .map((block) => ({
          id: block.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          speaker: block.speaker,
          content: block.content.trim(),
          confidence: typeof block.confidence === "number" ? block.confidence : undefined,
          source: source === "ocr" ? "ocr" : "manual",
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
      const refinementPrompt = `Mensaje base:\n${baseText}\n\nInstruccion del usuario:\n${instruction}`;
      const result = await postAdvisor({
        message_text: refinementPrompt,
        mode,
        relationship_type: "otro",
        case_id: selectedCaseId ?? undefined,
        source_type: "text",
        quick_mode: true,
        save_session: false,
        context: buildContextPayload(),
      });
      const refinedText = result.responses[advisorChatIndex]?.text ?? result.responses[0]?.text ?? baseText;
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
        { id: `a-${Date.now() + 1}`, role: "advisor", text: refinedText },
      ]);
      setAdvisorChatInput("");
    } catch (exc) {
      setAdvisorError(toUiErrorMessage(exc, "No se pudo refinar la respuesta de este adviser."));
    } finally {
      setAdvisorChatSending(false);
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
  const hasConversationInput = messageText.trim().length > 0 || conversationBlocks.length > 0;

  return (
    <Panel className="mx-auto flex h-[calc(100vh-180px)] w-full min-w-0 flex-col space-y-4 overflow-hidden border-[#e5e7eb] bg-white p-4 shadow-sm sm:p-5">
      <Stepper
        currentStep={currentStep}
        labels={[
          t("wizard.step.intake"),
          t("wizard.step.analysis"),
          t("wizard.step.responses"),
        ]}
      />

      {currentStep === 1 ? (
        <div className="flex min-h-0 flex-1 flex-col space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-[#1f2937]">Mensaje recibido</h3>
            <p className="mt-1 text-sm text-[#334155]">
              Sube, pega o escribe la conversacion. ExReply la interpreta automaticamente.
            </p>
            {caseError ? <p className="mt-2 text-xs text-red-700">{caseError}</p> : null}
          </div>

          <div className="grid min-h-0 flex-1 items-start gap-6 xl:grid-cols-2">
            <section
              className="min-h-0 min-w-0 space-y-3 overflow-y-auto rounded-2xl border border-[#E2E8F0] bg-white p-3 xl:max-h-[calc(100vh-360px)]"
              onPaste={handleStepOnePaste}
            >
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Conversacion</label>
                <Textarea
                  value={messageText}
                  onChange={(event) => handleMessageTextChange(event.target.value)}
                  rows={6}
                  placeholder="Pega aqui el mensaje que recibiste o copia la conversacion de WhatsApp"
                  spellCheck={false}
                  className="min-h-[170px] whitespace-pre-wrap break-words rounded-[10px] border border-[#ddd] bg-white p-4 text-[15px] leading-[1.5] text-[#1F2937]"
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
                  className="rounded-[6px] border border-[#ddd] bg-white px-[10px] py-[6px] text-[13px] text-[#111] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Seleccionar archivo
                </button>
                {ocrCapabilities?.available === false ? (
                  <p className="text-xs text-amber-700">
                    OCR no disponible: {resolveOcrErrorMessage(ocrCapabilities.reason_codes[0])}
                  </p>
                ) : null}
                {ocrLoading || autoParsing ? (
                  <p className="text-xs text-[#334155]">Procesando captura e interpretando mensajes...</p>
                ) : null}
                {ocrStatusMessage ? (
                  <p className="text-xs text-[#334155]">
                    {ocrStatusMessage}
                    {ocrInfo?.provider ? ` (${ocrInfo.provider})` : ""}
                  </p>
                ) : null}
                {ocrError ? <p className="text-xs text-red-700">{ocrError}</p> : null}
                {autoParseError ? <p className="text-xs text-amber-700">{autoParseError}</p> : null}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Contexto adicional (opcional)</label>
                <div id="wizard-context-optional-wrap" className="rounded-xl transition-all duration-200">
                  <Textarea
                    id="wizard-context-optional"
                    value={contextOptional}
                    onChange={(event) => setContextOptional(event.target.value)}
                    rows={3}
                    placeholder="Escribe lo que creas necesario para entender mejor la conversacion"
                    spellCheck={false}
                    className="rounded-[10px] border border-[#ddd] bg-[#fafafa] p-3 text-[14px] text-[#1F2937]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <VoiceMicButton
                    listening={contextVoice.listening}
                    disabled={contextVoice.microphoneStatus === "requesting"}
                    onClick={() => {
                      if (contextVoice.listening) {
                        contextVoice.stopListening();
                      } else {
                        contextVoice.startListening();
                      }
                    }}
                    idleLabel="Hablar en vez de escribir"
                    listeningLabel="Escuchando..."
                  />
                  <VoiceListeningBadge listening={contextVoice.listening} />
                </div>
                {contextMicrophoneStatusMessage ? (
                  <p className="text-[12px] text-[#666]">{contextMicrophoneStatusMessage}</p>
                ) : null}
                {contextVoice.error ? (
                  <p className="text-[12px] text-[#92400e]">{getSpeechToTextErrorMessage(contextVoice.error)}</p>
                ) : null}
                {isDevelopment ? (
                  <button
                    type="button"
                    onClick={() => {
                      void contextVoice.requestMicrophonePermission();
                    }}
                    disabled={contextVoice.microphoneStatus === "requesting"}
                    className="inline-flex h-8 items-center rounded-full border border-[#d7d7d7] bg-white px-3 text-[12px] text-[#334155] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Probar microfono
                  </button>
                ) : null}
              </div>
            </section>

            <section className="min-h-0 min-w-0 space-y-3 overflow-y-auto rounded-2xl border border-[#E2E8F0] bg-white p-3 xl:max-h-[calc(100vh-360px)]">
              <h4 className="text-sm font-semibold text-[#0F172A]">Conversacion interpretada</h4>
              <p className="text-xs text-[#64748B]">
                Revisa quien dijo cada mensaje antes de generar la respuesta.
              </p>

              <div className="max-h-[calc(100vh-400px)] min-h-[320px] space-y-2 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 pr-2">
                {conversationBlocks.length === 0 ? (
                  <p className="text-xs text-[#64748B]">
                    Cuando detectemos una conversacion, aparecera aqui en bloques editables.
                  </p>
                ) : null}
                {conversationBlocks.map((item) => (
                  <div
                    key={item.id}
                    className={`max-w-[96%] break-words rounded-[10px] border p-3 text-sm leading-6 transition-colors hover:border-[#d4d4d4] ${
                      item.speaker === "ex_partner"
                        ? "mr-auto border-[#f2d675] bg-[#fff7cc] text-[#3f3a23]"
                        : item.speaker === "user"
                          ? "ml-auto border-[#bcd4ff] bg-[#eaf3ff] text-[#213d6a]"
                          : "mr-auto border-[#f5b6c8] bg-[#fde7ef] text-[#5f3343]"
                    }`}
                  >
                    <div className="mb-2 inline-flex rounded-[14px] border border-[#ddd] bg-white p-0.5 text-[12px]">
                      <button
                        type="button"
                        onClick={() => updateConversationBlockSpeaker(item.id, "ex_partner")}
                        className={`inline-block rounded-[14px] px-2 py-[3px] ${
                          item.speaker === "ex_partner"
                            ? "border border-[#f2d675] bg-[#fff7cc] font-semibold text-[#6b5a26]"
                            : "text-[#64748B]"
                        }`}
                      >
                        Ex pareja
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConversationBlockSpeaker(item.id, "user")}
                        className={`inline-block rounded-[14px] px-2 py-[3px] ${
                          item.speaker === "user"
                            ? "border border-[#bcd4ff] bg-[#eaf3ff] font-semibold text-[#264a87]"
                            : "text-[#64748B]"
                        }`}
                      >
                        Yo
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConversationBlockSpeaker(item.id, "unknown")}
                        className={`inline-block rounded-[14px] px-2 py-[3px] ${
                          item.speaker === "unknown"
                            ? "border border-[#f5b6c8] bg-[#fde7ef] font-semibold text-[#7d3d52]"
                            : "text-[#64748B]"
                        }`}
                      >
                        Sin identificar
                      </button>
                    </div>
                    <Textarea
                      value={item.content}
                      onChange={(event) => updateConversationBlockText(item.id, event.target.value)}
                      rows={Math.max(2, Math.ceil(item.content.length / 42))}
                      spellCheck={false}
                      className="w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-sm leading-[1.6] focus-visible:ring-0"
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 z-10 mt-auto rounded-b-xl border-t border-[#eee] bg-white px-4 py-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Modo de respuesta</label>
                <div className="flex flex-wrap gap-2">
                  {responseStyleOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setResponseTone(item.value)}
                      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
                        responseTone === item.value
                          ? "border-[#bbb] bg-[#f3f4f6] text-[#111]"
                          : "border-[#ddd] bg-white text-[#666] hover:bg-[#fafafa]"
                      }`}
                    >
                      {item.value === "firme_respetuoso" ? "Firme" : item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasConversationInput ? (
                  <button
                    type="button"
                    onClick={handleStartNewConversation}
                    className="h-9 rounded-[8px] border border-[#ddd] bg-transparent px-4 text-[13px] text-[#111] hover:bg-[#fafafa]"
                  >
                    Limpiar
                  </button>
                ) : null}
                <Button
                  type="button"
                  onClick={handleContinueFromStep1}
                  disabled={(!messageText.trim() && conversationBlocks.length === 0) || loadingAnalysis}
                  variant="primary"
                  className="h-9 rounded-[8px] bg-[#111] px-4 text-[13px] text-white hover:bg-[#222]"
                >
                  {loadingAnalysis ? t("wizard.button.analyzing") : "Generar respuestas"}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setQuickMode(true);
                    void handleQuickResponse();
                  }}
                  disabled={(!messageText.trim() && conversationBlocks.length === 0) || loadingAdvisor}
                  variant="secondary"
                  className="h-9 border-[#ddd] bg-transparent px-3 text-[13px] text-[#666] hover:bg-[#fafafa]"
                >
                  {loadingAdvisor ? t("wizard.button.generating") : "Rapida"}
                </Button>
              </div>
            </div>
            {advisorError ? <p className="mt-2 text-sm text-red-700">{advisorError}</p> : null}
          </div>
        </div>
      ) : null}
      {currentStep === 2 ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-[#1f2937]">Paso 2: Analisis</h3>
            <p className="mt-1 text-sm text-[#334155]">
              Revisamos el tono general antes de generar las respuestas.
            </p>
          </div>

          <div className="min-h-6">
            {loadingAnalysis ? (
              <p className="text-sm text-[#334155]">Analizando conversacion...</p>
            ) : null}
            {analysisError ? <p className="text-sm text-red-700">{analysisError}</p> : null}
            {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
          </div>

          {analysisResult ? (
            <>
              <div
                className={`rounded-2xl border px-4 py-4 ${analysisStatus?.className ?? ""}`}
              >
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

              <div className="grid gap-3 md:grid-cols-2">
                <StepSection title="Resumen">
                  <p>{analysisResult.summary}</p>
                </StepSection>

                <StepSection title="Contexto emocional">
                  <p>
                    <span className="font-medium text-[#1f2937]">Tono detectado:</span>{" "}
                    {analysisResult.emotional_context.tone || "no disponible"}.
                  </p>
                  <p>
                    <span className="font-medium text-[#1f2937]">Objetivo sugerido:</span>{" "}
                    {analysisResult.emotional_context.intent_guess || "sin sugerencia clara"}.
                  </p>
                </StepSection>

                <StepSection title="Riesgos">
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
                </StepSection>

                <StepSection title="Alertas">
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
                </StepSection>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  variant="secondary"
                  className="border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
                >
                  Volver
                </Button>
                <Button
                  type="button"
                  onClick={handleContinueToStep3}
                  disabled={!analysisId || loadingAdvisor}
                  variant="primary"
                  className="min-w-[150px] bg-[#1f2937] hover:bg-[#111827]"
                >
                  {loadingAdvisor ? t("wizard.button.generating") : t("wizard.button.continue")}
                </Button>
              </div>

              <div className="rounded-2xl border border-[#dbe3ec] bg-[#f8fafc] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#1f2937]">Hecho relevante</p>
                  <Button
                    type="button"
                    onClick={openIncidentCapture}
                    variant="secondary"
                    className="border-[#cbd5e1] bg-white text-[#334155]"
                  >
                    Registrar incidente
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[#475569]">
                  Si corresponde, guarda este evento para revisar el historial del caso.
                </p>
                {incidentVisible ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <Select
                      value={incidentType}
                      onChange={(event) => setIncidentType(event.target.value as IncidentType)}
                      className="border-[#e5e7eb] bg-white text-[#1f2937]"
                    >
                      {INCIDENT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <input
                      type="date"
                      value={incidentDate}
                      onChange={(event) => setIncidentDate(event.target.value)}
                      className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#1f2937]"
                    />
                    <input
                      type="text"
                      value={incidentTitle}
                      onChange={(event) => setIncidentTitle(event.target.value)}
                      placeholder="Titulo breve del evento"
                      className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#1f2937] md:col-span-2"
                    />
                    <Textarea
                      value={incidentDescription}
                      onChange={(event) => setIncidentDescription(event.target.value)}
                      rows={2}
                      spellCheck={false}
                      placeholder="Detalle opcional para contexto futuro"
                      className="border-[#e5e7eb] bg-white text-[#1f2937] md:col-span-2"
                    />
                    <div className="md:col-span-2">
                      <Button
                        type="button"
                        onClick={() => void handleRegisterIncident()}
                        disabled={incidentSaving || !incidentTitle.trim()}
                        variant="secondary"
                        className="border-[#cbd5e1] bg-white text-[#334155]"
                      >
                        {incidentSaving ? "Guardando..." : "Guardar evento"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {incidentNotice ? <p className="mt-2 text-xs text-[#334155]">{incidentNotice}</p> : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {currentStep === 3 ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-[#1f2937]">Paso 3: Respuestas</h3>
            <p className="mt-1 text-sm text-[#334155]">
              Elige la variante que mejor encaja con tu objetivo.
            </p>
          </div>

          <div className="min-h-6">
            {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
            {loadingAdvisor ? (
              <p className="text-sm text-[#334155]">Generando respuestas...</p>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => {
              const advisorVisual = getAdvisorVisualByIndex(index);
              const responseText = advisorResult?.responses[index]?.text ?? "";
              const isRecommended = index === 0;

              return (
                <article
                  key={`${advisorVisual.id}-${index}`}
                  onClick={() => openAdvisorChat(index)}
                  className={`mb-3 flex min-w-0 cursor-pointer flex-col rounded-[10px] border bg-white p-4 transition-all duration-150 ease-in-out hover:border-[#d4d4d4] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${
                    isRecommended ? "border-[#22c55e]" : "border-[#e5e5e5]"
                  }`}
                >
                  <header className="rounded-[10px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-3 text-[#111]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <AdvisorAvatarItem
                          name={advisorVisual.name}
                          role={advisorVisual.role}
                          avatarSrc={advisorVisual.avatar64}
                          size={56}
                          tone="light"
                          onClick={() => openAdvisorProfileById(advisorVisual.id)}
                        />
                      </div>
                      <span className="shrink-0 rounded-[6px] bg-[#f3f4f6] px-2 py-1 text-[12px] text-[#444]">
                        {responseStyleBadgeByIndex[index]}
                      </span>
                    </div>
                    {isRecommended ? (
                      <p className="mt-2 inline-flex rounded-[6px] border border-[#22c55e] bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-semibold text-[#166534]">
                        Recomendado
                      </p>
                    ) : null}
                  </header>

                  <p className="mt-4 flex-1 whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-[#222]">
                    {responseText || "Sin respuesta disponible."}
                  </p>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {speechSynthesis.supported ? (
                      <VoicePlaybackButton
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleSpeakResponse(index, responseText);
                        }}
                        speaking={speechSynthesis.speaking && speakingResponseIndex === index}
                        disabled={!responseText}
                      />
                    ) : null}
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAdvisorChat(index);
                      }}
                      disabled={!responseText}
                      variant="secondary"
                      className="h-9 border-[#ddd] bg-transparent px-3 text-[13px] text-[#111] hover:bg-[#fafafa]"
                    >
                      Refinar
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
                          : "bg-[#111] text-white hover:bg-[#222]"
                      }`}
                    >
                      {copiedIndex === index ? "Respuesta copiada" : "Usar esta respuesta"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              onClick={openIncidentCapture}
              variant="secondary"
              className="border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
            >
              Registrar incidente
            </Button>
            <Button
              type="button"
              onClick={() => setCurrentStep(2)}
              variant="secondary"
              className="border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
            >
              Volver al paso 2
            </Button>
            <Button
              type="button"
              onClick={handleStartNewConversation}
              variant="primary"
              className="bg-[#1f2937] hover:bg-[#111827]"
            >
              Iniciar nueva conversacion
            </Button>
              <Button
                type="button"
                onClick={() => setCurrentStep(1)}
                variant="secondary"
                className="border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
              >
                Ninguna me sirve / Quiero explicar más contexto
              </Button>
          </div>
          {incidentVisible ? (
            <div className="rounded-2xl border border-[#dbe3ec] bg-[#f8fafc] p-3">
              <p className="text-sm font-semibold text-[#1f2937]">Registrar evento del caso</p>
              <p className="mt-1 text-xs text-[#475569]">
                Guarda este hecho para mantener contexto cronologico del caso.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <Select
                  value={incidentType}
                  onChange={(event) => setIncidentType(event.target.value as IncidentType)}
                  className="border-[#e5e7eb] bg-white text-[#1f2937]"
                >
                  {INCIDENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <input
                  type="date"
                  value={incidentDate}
                  onChange={(event) => setIncidentDate(event.target.value)}
                  className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#1f2937]"
                />
                <input
                  type="text"
                  value={incidentTitle}
                  onChange={(event) => setIncidentTitle(event.target.value)}
                  placeholder="Titulo breve del evento"
                  className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#1f2937] md:col-span-2"
                />
                <Textarea
                  value={incidentDescription}
                  onChange={(event) => setIncidentDescription(event.target.value)}
                  rows={2}
                  spellCheck={false}
                  placeholder="Detalle opcional para contexto futuro"
                  className="border-[#e5e7eb] bg-white text-[#1f2937] md:col-span-2"
                />
                <div className="md:col-span-2">
                  <Button
                    type="button"
                    onClick={() => void handleRegisterIncident()}
                    disabled={incidentSaving || !incidentTitle.trim()}
                    variant="secondary"
                    className="border-[#cbd5e1] bg-white text-[#334155]"
                  >
                    {incidentSaving ? "Guardando..." : "Guardar evento"}
                  </Button>
                </div>
              </div>
              {incidentNotice ? <p className="mt-2 text-xs text-[#334155]">{incidentNotice}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <AdvisorChatModal
        isOpen={advisorChatOpen}
        advisorName={advisorChatIndex !== null ? getAdvisorVisualByIndex(advisorChatIndex).name : "Adviser"}
        messages={advisorChatMessages}
        draft={advisorChatInput}
        sending={advisorChatSending}
        onDraftChange={setAdvisorChatInput}
        onSend={() => void handleSendAdvisorRefinement()}
        onUseResponse={() => setAdvisorChatOpen(false)}
        onClose={() => setAdvisorChatOpen(false)}
      />
      <AdvisorProfileModal profile={selectedProfile} onClose={() => setSelectedProfile(null)} />
    </Panel>
  );
}
