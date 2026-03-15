"use client";

import Image from "next/image";
import { type ChangeEvent, useEffect, useState } from "react";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import { Button, Panel, Select, Textarea } from "@/components/mvp/ui";
import { CaseTimeline } from "@/components/cases/CaseTimeline";
import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { authFetch } from "@/lib/auth/client";
import { hasStoredSession } from "@/lib/auth/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import {
  downloadCaseExport,
  getCases,
  getIncidents,
  patchIncident,
  postAdvisor,
  postAnalysis,
  postIncident,
  postWizardEvent,
} from "@/lib/api/client";
import type { AdvisorProfile } from "@/data/advisors";
import { API_URL } from "@/lib/config";
import { resolveRuntimeLocale, tRuntime } from "@/lib/i18n/runtime";
import type {
  AdvisorResponse,
  AnalysisResponse,
  AnalysisRiskFlag,
  CaseSummary,
  IncidentSummary,
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

type ChatSender = "incoming" | "outgoing";
type ResponseTone = (typeof responseStyleOptions)[number]["value"];
type ConversationMessage = {
  id: string;
  sender: ChatSender;
  text: string;
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

const ADVISOR_ACCENT_CLASS = [
  "border-t-[3px] border-t-emerald-500",
  "border-t-[3px] border-t-blue-500",
  "border-t-[3px] border-t-amber-500",
] as const;
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

function formatConversationForAdvisorContext(
  history: ConversationMessage[],
  latestIncomingMessage: string,
): string {
  const lines: string[] = [];
  for (const item of history) {
    const prefix = item.sender === "incoming" ? "Ex-partner" : "User";
    const text = item.text.trim();
    if (!text) continue;
    lines.push(`${prefix}: ${text}`);
  }
  const latest = latestIncomingMessage.trim();
  if (latest) {
    lines.push(`Ex-partner: ${latest}`);
  }
  return lines.join("\n");
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
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [historyInputOpen, setHistoryInputOpen] = useState(false);
  const [historySender, setHistorySender] = useState<ChatSender>("incoming");
  const [historyMessageText, setHistoryMessageText] = useState("");
  const [ocrImageFile, setOcrImageFile] = useState<File | null>(null);
  const [ocrImagePreviewUrl, setOcrImagePreviewUrl] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrInfo, setOcrInfo] = useState<OcrExtractResponse | null>(null);
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
  const [exportingCase, setExportingCase] = useState(false);
  const [caseIncidents, setCaseIncidents] = useState<IncidentSummary[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [confirmingIncidentId, setConfirmingIncidentId] = useState<string | null>(null);
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);
  const selectedCaseId = activeCase?.id ?? null;

  useEffect(() => {
    if (!ocrImageFile) {
      setOcrImagePreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(ocrImageFile);
    setOcrImagePreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [ocrImageFile]);

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
    async function loadCaseIncidents() {
      if (!selectedCaseId) {
        setCaseIncidents([]);
        setIncidentsError(null);
        setIncidentsLoading(false);
        return;
      }
      setIncidentsLoading(true);
      setIncidentsError(null);
      try {
        const payload = await getIncidents(selectedCaseId);
        if (!mounted) return;
        setCaseIncidents(payload.incidents);
      } catch (exc) {
        if (!mounted) return;
        setIncidentsError(toUiErrorMessage(exc, "No se pudieron cargar incidentes del caso."));
      } finally {
        if (mounted) setIncidentsLoading(false);
      }
    }
    void loadCaseIncidents();
    return () => {
      mounted = false;
    };
  }, [selectedCaseId]);

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

  function openAdvisorProfileById(advisorId: string) {
    const profile = ADVISOR_PROFILES.find((advisor) => advisor.id === advisorId) ?? null;
    setSelectedProfile(profile);
  }

  function buildContextPayload() {
    const context: Record<string, unknown> = {};
    if (contextOptional.trim()) context.contact_context = contextOptional.trim();
    context.user_style = responseTone;
    const structuredConversation = formatConversationForAdvisorContext(
      conversationHistory,
      messageText,
    );
    if (structuredConversation) {
      context.conversation_structured = structuredConversation;
    }
    if (messageText.trim()) {
      context.latest_ex_partner_message = messageText.trim();
    }
    if (conversationHistory.length > 0) {
      context.conversation_history = conversationHistory.map((item) => ({
        sender: item.sender,
        text: item.text,
      }));
    }
    return Object.keys(context).length > 0 ? context : undefined;
  }

  function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file && !file.type.startsWith("image/")) {
      setOcrImageFile(null);
      setOcrError("Selecciona una imagen valida (PNG, JPG o WebP).");
      setOcrInfo(null);
      return;
    }
    setOcrImageFile(file);
    setOcrError(null);
    setOcrInfo(null);
  }

  async function handleExtractTextFromImage() {
    if (!ocrImageFile || ocrLoading) return;
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
      formData.append("file", ocrImageFile);
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

  async function runAnalysis() {
    const text = messageText.trim();
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
    const text = messageText.trim();
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
    if (!messageText.trim()) return;
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
    setOcrImageFile(null);
    setOcrInfo(null);
    setOcrError(null);
    setOcrLoading(false);
    setConversationHistory([]);
    setHistoryInputOpen(false);
    setHistorySender("incoming");
    setHistoryMessageText("");
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
      const created = await postIncident({
        case_id: selectedCaseId,
        incident_type: incidentType,
        title: normalizedTitle,
        description: incidentDescription.trim(),
        source_type: "wizard",
        related_analysis_id: analysisId ?? undefined,
        related_session_id: advisorResult?.session_id ?? undefined,
        incident_date: incidentDate,
      });
      setCaseIncidents((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
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

  async function handleConfirmIncident(incidentId: string) {
    if (confirmingIncidentId) return;
    setConfirmingIncidentId(incidentId);
    setIncidentsError(null);
    try {
      const updated = await patchIncident(incidentId, { confirmed: true });
      setCaseIncidents((previous) =>
        previous.map((item) => (item.id === incidentId ? updated : item)),
      );
    } catch (exc) {
      setIncidentsError(toUiErrorMessage(exc, "No se pudo confirmar el incidente."));
    } finally {
      setConfirmingIncidentId(null);
    }
  }

  async function handleExportCase() {
    if (!selectedCaseId || exportingCase) return;
    setExportingCase(true);
    setCaseError(null);
    try {
      await downloadCaseExport(selectedCaseId);
    } catch (exc) {
      setCaseError(toUiErrorMessage(exc, "No se pudo exportar el caso."));
    } finally {
      setExportingCase(false);
    }
  }

  function handleAddHistoryMessage() {
    const normalized = historyMessageText.trim();
    if (!normalized) return;
    const message: ConversationMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: historySender,
      text: normalized,
    };
    setConversationHistory((prev) => [...prev, message]);
    setHistoryMessageText("");
    setHistoryInputOpen(false);
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

  const analysisStatus = analysisResult ? getAnalysisStatus(analysisResult) : null;

  return (
    <Panel className="mx-auto w-full min-w-0 space-y-5 overflow-x-hidden border-[#e5e7eb] bg-white p-4 shadow-sm sm:p-5">
      <Stepper
        currentStep={currentStep}
        labels={[
          t("wizard.step.intake"),
          t("wizard.step.analysis"),
          t("wizard.step.responses"),
        ]}
      />

      {currentStep === 1 ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Contexto del caso</p>
                <p className="text-sm font-semibold text-[#0F172A]">
                  {activeCase?.title || "Sin contexto disponible"}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void handleExportCase()}
                disabled={!selectedCaseId || exportingCase}
                variant="secondary"
                className="border-[#CBD5E1] bg-white text-[#334155]"
              >
                {exportingCase ? "Exportando..." : "Exportar caso"}
              </Button>
            </div>
            {activeCase?.summary ? (
              <p className="mt-2 text-xs text-[#475569]">{activeCase.summary}</p>
            ) : null}
            {caseError ? <p className="mt-2 text-xs text-red-700">{caseError}</p> : null}
          </div>

          <div>
            <h3 className="text-lg font-semibold text-[#1f2937]">Mensaje recibido</h3>
            <p className="mt-1 text-sm text-[#334155]">
              Escribe el mensaje y agrega contexto para generar respuestas mas claras.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="min-w-0 space-y-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Mensaje recibido</label>
                <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelection}
                      className="text-xs text-[#334155]"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleExtractTextFromImage()}
                      disabled={
                        !ocrImageFile ||
                        ocrLoading ||
                        ocrCapabilitiesLoading ||
                        ocrCapabilities?.available === false
                      }
                      variant="secondary"
                      className="border-[#CBD5E1] bg-white px-3 py-1.5 text-xs text-[#334155]"
                    >
                      {ocrLoading
                        ? "Leyendo texto..."
                        : ocrCapabilitiesLoading
                          ? "Preparando OCR..."
                          : "Leer texto de la imagen"}
                    </Button>
                  </div>
                  {ocrCapabilities?.available === false ? (
                    <p className="mt-2 text-xs text-amber-700">
                      OCR no disponible: {resolveOcrErrorMessage(ocrCapabilities.reason_codes[0])}
                    </p>
                  ) : null}
                  {ocrImagePreviewUrl ? (
                    <Image
                      src={ocrImagePreviewUrl}
                      alt="Preview OCR"
                      width={560}
                      height={260}
                      className="mt-3 max-h-56 w-full rounded-lg border border-[#DBE3EC] object-contain"
                    />
                  ) : null}
                  {ocrInfo ? (
                    <p className="mt-2 text-xs text-[#334155]">
                      Texto cargado desde imagen ({ocrInfo.provider})
                      {ocrInfo.confidence !== null ? `, confianza ${(ocrInfo.confidence * 100).toFixed(1)}%` : ""}
                    </p>
                  ) : null}
                  {ocrError ? <p className="mt-2 text-xs text-red-700">{ocrError}</p> : null}
                </div>
                <Textarea
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  rows={6}
                  placeholder="Pega aquí el mensaje que recibiste o copia la conversación de WhatsApp"
                  className="min-h-[170px] rounded-xl border-[#E2E8F0] bg-white text-[#1F2937]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Contexto adicional (opcional)</label>
                <Textarea
                  value={contextOptional}
                  onChange={(event) => setContextOptional(event.target.value)}
                  rows={3}
                  placeholder="Escribe lo que creas necesario para que entendamos mejor la conversación"
                  className="border-[#E2E8F0] bg-white text-[#1F2937]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Modo de respuesta</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {responseStyleOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setResponseTone(item.value)}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                        responseTone === item.value
                          ? "border-[#3B82F6] bg-[#EFF6FF] text-[#1E3A8A]"
                          : "border-[#E2E8F0] bg-white text-[#334155] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  onClick={handleContinueFromStep1}
                  disabled={!messageText.trim() || loadingAnalysis}
                  variant="primary"
                  className="min-w-[170px] bg-[#1F2937] hover:bg-[#111827]"
                >
                  {loadingAnalysis ? t("wizard.button.analyzing") : t("wizard.button.continue")}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setQuickMode(true);
                    void handleQuickResponse();
                  }}
                  disabled={!messageText.trim() || loadingAdvisor}
                  variant="secondary"
                  className="min-w-[170px] border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]"
                >
                  {loadingAdvisor ? t("wizard.button.generating") : t("wizard.button.quick_reply")}
                </Button>
              </div>
              {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
            </section>

            <section className="min-w-0 space-y-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[#0F172A]">Historial conversacion</h4>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setHistoryInputOpen((prev) => !prev)}
                  className="border-[#CBD5E1] bg-white px-3 py-1.5 text-xs text-[#334155]"
                >
                  Agregar mensaje previo
                </Button>
              </div>

              <div className="max-h-[340px] space-y-2 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                {conversationHistory.length === 0 && !messageText.trim() ? (
                  <p className="text-xs text-[#64748B]">
                    Agrega mensajes previos para dar contexto visual a la conversacion.
                  </p>
                ) : null}
                {conversationHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`max-w-[86%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                      item.sender === "incoming"
                        ? "mr-auto bg-[#EEF2F7] text-[#0F172A]"
                        : "ml-auto bg-[#DBEAFE] text-[#1E3A8A]"
                    }`}
                  >
                    {item.text}
                  </div>
                ))}
                {messageText.trim() ? (
                  <div className="max-w-[86%] rounded-2xl bg-[#EEF2F7] px-3 py-2 text-sm leading-6 text-[#0F172A]">
                    {messageText.trim()}
                  </div>
                ) : null}
              </div>

              {historyInputOpen ? (
                <div className="space-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                    Mensaje de
                  </label>
                  <Select
                    value={historySender}
                    onChange={(event) => setHistorySender(event.target.value as ChatSender)}
                    className="border-[#E2E8F0] bg-white text-[#1F2937]"
                  >
                    <option value="incoming">Mi expareja</option>
                    <option value="outgoing">Yo</option>
                  </Select>
                  <Textarea
                    value={historyMessageText}
                    onChange={(event) => setHistoryMessageText(event.target.value)}
                    rows={3}
                    placeholder="Escribe el mensaje previo"
                    className="border-[#E2E8F0] bg-white text-[#1F2937]"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={handleAddHistoryMessage}
                      disabled={!historyMessageText.trim()}
                      variant="secondary"
                      className="border-[#CBD5E1] bg-white text-[#334155]"
                    >
                      Guardar mensaje
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <p className="text-sm font-semibold text-[#1F2937]">Case Context</p>
                {!selectedCaseId ? (
                  <p className="mt-2 text-xs text-[#475569]">Sin contexto disponible.</p>
                ) : (
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[#1f2937]">Timeline</p>
                      <CaseTimeline caseId={selectedCaseId} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[#1f2937]">Incidents</p>
                      {incidentsLoading ? (
                        <p className="text-xs text-[#475569]">Cargando incidentes...</p>
                      ) : incidentsError ? (
                        <p className="text-xs text-red-700">{incidentsError}</p>
                      ) : caseIncidents.length === 0 ? (
                        <p className="text-xs text-[#475569]">Sin incidentes para este caso.</p>
                      ) : (
                        <ul className="space-y-2">
                          {caseIncidents.map((incident) => (
                            <li key={incident.id} className="rounded-lg border border-[#E2E8F0] bg-white p-2 text-xs text-[#334155]">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-[#1f2937]">{incident.incident_type}</span>
                                <span>{new Date(incident.incident_date).toLocaleDateString()}</span>
                              </div>
                              <p className="mt-1">{incident.title}</p>
                              <div className="mt-2 flex items-center justify-between">
                                <span>{incident.confirmed ? "Confirmado" : "Pendiente confirmar"}</span>
                                {!incident.confirmed ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="border-[#CBD5E1] bg-white text-[#334155]"
                                    disabled={confirmingIncidentId === incident.id}
                                    onClick={() => void handleConfirmIncident(incident.id)}
                                  >
                                    {confirmingIncidentId === incident.id ? "Confirmando..." : "Confirm incident"}
                                  </Button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
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
                  className={`flex min-w-0 cursor-pointer flex-col rounded-2xl border bg-white p-3 shadow-sm ${
                    isRecommended ? "border-[#16A34A]" : "border-[#e5e7eb]"
                  } ${ADVISOR_ACCENT_CLASS[index]}`}
                >
                  <header className="rounded-xl bg-[#334155] px-3 py-2 text-white">
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
                      <span className="shrink-0 rounded-full bg-white/15 px-2 py-1 text-[11px] font-medium text-white">
                        {responseStyleBadgeByIndex[index]}
                      </span>
                    </div>
                    {isRecommended ? (
                      <p className="mt-2 inline-flex rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-semibold text-[#166534]">
                        Recomendado
                      </p>
                    ) : null}
                  </header>

                  <p className="mt-4 flex-1 break-words text-[15px] leading-7 text-[#1f2937]">
                    {responseText || "Sin respuesta disponible."}
                  </p>

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAdvisorChat(index);
                      }}
                      disabled={!responseText}
                      variant="secondary"
                      className="border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#334155] hover:bg-[#F8FAFC]"
                    >
                      Refinar con adviser
                    </Button>
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCopy(responseText, index);
                      }}
                      disabled={!responseText}
                      variant="primary"
                      className={`px-3 py-2 text-sm ${
                        copiedIndex === index
                          ? "bg-[#16A34A] text-white hover:bg-[#15803d]"
                          : "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                      }`}
                    >
                      {copiedIndex === index ? "Respuesta copiada ✓" : "Usar esta respuesta"}
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
