"use client";

import { type ChangeEvent, type ClipboardEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import { useMvpShell } from "@/components/mvp/MvpShellContext";
import type { SidebarConversationSummary } from "@/components/mvp/MvpShellContext";
import styles from "@/components/mvp/MvpShell.module.css";
import { VoicePlaybackButton } from "@/components/mvp/VoiceControls";
import { Button, Panel, Textarea } from "@/components/mvp/ui";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { authFetch } from "@/lib/auth/client";
import { hasStoredSession } from "@/lib/auth/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import {
  getCases,
  patchConversation,
  postAdvisor,
  postAdvisorChat,
  postAnalysis,
  postIncident,
  postMessage,
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
  EmotionLabel,
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
type StepOneInputMode = "write" | "capture" | "voice";
type DecisionActionId =
  | "no_reply"
  | "brief_neutral"
  | "clear_limit"
  | "reply_later"
  | "advisor_help";

type DecisionAction = {
  id: DecisionActionId;
  title: string;
  subtitle: string;
};

export type ConversationResumeState = {
  targetStep: 3 | 4;
  sourceText: string | null;
  analysisAction: string | null;
  selectedReply: string | null;
};

function mapConversationSummaryToSidebar(conversation: {
  id: string;
  title: string;
  title_status: string;
  advisor_id: string | null;
  created_at: string;
  last_message_at: string;
}): SidebarConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    titleStatus: conversation.title_status as SidebarConversationSummary["titleStatus"],
    advisorId: conversation.advisor_id,
    startedAt: conversation.created_at,
    lastMessageAt: conversation.last_message_at,
  };
}

type DecisionSignals = {
  hasConcreteQuestion: boolean;
  hasLogisticsRequest: boolean;
  hasImmediateUrgency: boolean;
  hasHighEmotionOrEscalation: boolean;
  hasBoundaryOrAggression: boolean;
  hasChildrenOrCoordination: boolean;
  shouldAvoidImmediateReply: boolean;
  shouldOfferBriefReply: boolean;
  shouldOfferClearLimit: boolean;
  shouldOfferLaterReply: boolean;
};

const SPEAKER_LABELS: Record<ConversationBlock["speaker"], string> = {
  ex_partner: "Ex pareja",
  user: "Yo",
  unknown: "Sin identificar",
};

const DECISION_DISPLAY_ORDER: Record<DecisionActionId, number> = {
  brief_neutral: 0,
  no_reply: 1,
  clear_limit: 2,
  reply_later: 3,
  advisor_help: 4,
};

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

function getResumePreviewText(content: string | null, maxLength = 220) {
  const normalized = content?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
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

function getReplyTimingGuidance(analysisResult: AnalysisResponse) {
  const status = getAnalysisStatus(analysisResult);
  if (status.kind === "risk") {
    return {
      title: "Es mejor esperar un momento",
      description: status.description,
    };
  }
  if (status.kind === "observation") {
    return {
      title: "Conviene responder con cautela",
      description: status.description,
    };
  }
  return {
    title: "Puedes responder si mantienes el foco",
    description: status.description,
  };
}

function getIgnoreGuidance(analysisResult: AnalysisResponse) {
  if (analysisResult.ui_alerts.length > 0) {
    return analysisResult.ui_alerts
      .slice(0, 2)
      .map((alert) => alert.message)
      .join(" ");
  }
  if (analysisResult.risk_flags.length > 0) {
    return analysisResult.risk_flags
      .slice(0, 2)
      .map((flag) => humanizeFlag(flag))
      .join(". ");
  }
  return "No hay alertas adicionales relevantes en este análisis; quédate con el pedido concreto.";
}

function resolveAdvisorResponseIndex(
  advisorResult: AdvisorResponse | null,
  actionId: Exclude<DecisionActionId, "no_reply" | "advisor_help">,
) {
  if (!advisorResult) return null;

  const byEmotion = (labels: EmotionLabel[]) =>
    advisorResult.responses.findIndex((response) => labels.includes(response.emotion_label));

  if (actionId === "brief_neutral") {
    const emotionIndex = byEmotion(["neutral", "calm", "friendly"]);
    if (emotionIndex >= 0) return emotionIndex;
    return advisorResult.responses[2] ? 2 : 0;
  }

  if (actionId === "clear_limit") {
    const emotionIndex = byEmotion(["assertive"]);
    if (emotionIndex >= 0) return emotionIndex;
    return advisorResult.responses[1] ? 1 : 0;
  }

  const emotionIndex = byEmotion(["calm", "empathetic", "friendly"]);
  if (emotionIndex >= 0) return emotionIndex;
  return advisorResult.responses[0] ? 0 : null;
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function getDecisionSignals(
  analysisResult: AnalysisResponse | null,
  blocks: ConversationBlock[],
  fallbackText: string,
): DecisionSignals {
  const latestIncomingText = (
    getLatestExPartnerMessage(blocks) ?? getConversationSubmissionText(blocks, fallbackText)
  ).toLowerCase();
  const backendDerivedText = [
    analysisResult?.summary ?? "",
    analysisResult?.emotional_context.intent_guess ?? "",
    analysisResult?.emotional_context.tone ?? "",
    analysisResult?.tone_detected ?? "",
    ...(analysisResult?.ui_alerts.map((alert) => alert.message) ?? []),
    ...(analysisResult?.risk_flags.map((flag) => flag.code.replaceAll("_", " ")) ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const combinedText = `${latestIncomingText}\n${backendDerivedText}`;
  const riskCodes = new Set(analysisResult?.risk_flags.map((flag) => flag.code) ?? []);
  const analysisStatusKind = analysisResult ? getAnalysisStatus(analysisResult).kind : "ok";

  const hasConcreteQuestion =
    latestIncomingText.includes("?") ||
    matchesAny(latestIncomingText, [
      /\b(cuando|cuándo|donde|dónde|como|cómo|quien|quién|puedes|podes|podés|podrias|podrías)\b/,
      /\b(me confirmas|confirmame|avisame|decime|dime|necesito saber|quiero saber)\b/,
      /\b(vas a|puedo|podemos|vas a poder)\b/,
    ]);

  const hasLogisticsRequest = matchesAny(combinedText, [
    /\b(horario|hora|horas|agenda|calendario|coordina|coordinar|organiza|organizar)\b/,
    /\b(visita|visitas|retiro|entrega|buscar|llevar|pasar|fin de semana)\b/,
    /\b(colegio|escuela|guarderia|guardería|medico|médico|doctor|vacuna)\b/,
    /\b(pago|pagos|gasto|gastos|transferencia|cuota|reintegro)\b/,
    /\b(permiso|papeles|firma|documento|documentos|viaje|vacaciones)\b/,
  ]);

  const hasImmediateUrgency =
    riskCodes.has("urgency_conflict") ||
    matchesAny(combinedText, [/\b(urgente|urgencia|hoy|ahora|cuanto antes|enseguida)\b/]);

  const hasHighEmotionOrEscalation =
    riskCodes.has("high_emotion") ||
    riskCodes.has("passive_aggressive") ||
    analysisResult?.ui_alerts.some((alert) => alert.level === "critical") === true ||
    matchesAny(combinedText, [
      /\b(agresiv|hostil|provoc|escal|enoj|rabia|ira|manipul|culpa|tension|tensión|conflict)\b/,
    ]) ||
    analysisStatusKind === "risk";

  const hasBoundaryOrAggression =
    riskCodes.has("boundary_pressure") ||
    matchesAny(combinedText, [
      /\b(limite|límite|presion|presión|control|amenaz|insult|falta de respeto)\b/,
      /\b(respondeme|respóndeme|tenes que|tenés que|deja de|dejame en paz)\b/,
      /\b(no me escribas|no aparezcas|no vengas)\b/,
    ]);

  const hasChildrenOrCoordination =
    riskCodes.has("custody_related") ||
    matchesAny(combinedText, [
      /\b(hijo|hija|hijos|hijas|nene|nena|nenes|nenas|niño|niña|niños|niñas)\b/,
      /\b(coparent|coordinacion|coordinación|visita|retiro|entrega)\b/,
      /\b(colegio|escuela|guarderia|guardería|medico|médico|doctor|vacuna)\b/,
    ]);

  const intentSuggestsReply = matchesAny(backendDerivedText, [
    /\b(coordina|coordinar|organiza|organizar|aclara|aclarar|pregunta|confirm|solicita)\b/,
    /\b(respuesta|responder|resolver|logistica|logística)\b/,
  ]);

  const hasConcreteRequest = hasConcreteQuestion || hasLogisticsRequest || intentSuggestsReply;
  const shouldAvoidImmediateReply =
    !hasConcreteRequest || analysisStatusKind === "risk" || (hasHighEmotionOrEscalation && !hasImmediateUrgency);
  const shouldOfferBriefReply = hasConcreteRequest || hasImmediateUrgency;
  const shouldOfferClearLimit =
    riskCodes.has("boundary_pressure") ||
    riskCodes.has("custody_related") ||
    hasBoundaryOrAggression ||
    (hasChildrenOrCoordination && (analysisStatusKind !== "ok" || hasHighEmotionOrEscalation));
  const shouldOfferLaterReply =
    shouldOfferBriefReply && (analysisStatusKind !== "ok" || hasHighEmotionOrEscalation);

  return {
    hasConcreteQuestion,
    hasLogisticsRequest,
    hasImmediateUrgency,
    hasHighEmotionOrEscalation,
    hasBoundaryOrAggression,
    hasChildrenOrCoordination,
    shouldAvoidImmediateReply,
    shouldOfferBriefReply,
    shouldOfferClearLimit,
    shouldOfferLaterReply,
  };
}

function getDecisionActions(signals: DecisionSignals): DecisionAction[] {
  const actions: DecisionAction[] = [];

  if (signals.shouldAvoidImmediateReply) {
    actions.push({
      id: "no_reply",
      title: "No responder ahora",
      subtitle: signals.hasHighEmotionOrEscalation
        ? "Responder ahora puede empeorarlo"
        : "Dejalo pasar, no requiere respuesta inmediata",
    });
  }

  if (signals.shouldOfferBriefReply) {
    actions.push({
      id: "brief_neutral",
      title: "Responder breve y neutro",
      subtitle: "Solo los hechos, sin entrar en el tono",
    });
  }

  if (signals.shouldOfferClearLimit) {
    actions.push({
      id: "clear_limit",
      title: "Poner un limite claro",
      subtitle: signals.hasChildrenOrCoordination
        ? "Firme, sin agredir, centrado en los hijos"
        : "Marca el limite sin engancharte",
    });
  }

  if (signals.shouldOfferLaterReply) {
    actions.push({
      id: "reply_later",
      title: "Responder mas tarde",
      subtitle: "Cuando estes mas tranquilo/a",
    });
  }

  actions.push({
    id: "advisor_help",
    title: "Consultar con un consejero",
    subtitle: "Laura, Robert o Lidia te ayudan a decidir",
  });

  return actions;
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

function getSafeTopicLabel(
  rawTopic: string | null | undefined,
  blocks: ConversationBlock[],
  fallbackText: string,
) {
  const source = `${rawTopic ?? ""}\n${buildSidebarConversationTitle(blocks, fallbackText)}`.toLowerCase();

  if (!source.trim()) return "Sin tema claro";
  if (/(famil|hijo|hija|custodia|coparent|colegio|escuela|medico|vacuna)/.test(source)) {
    return "Tema familiar";
  }
  if (/(coordina|horario|agenda|turno|visita|retiro|entrega|fin de semana)/.test(source)) {
    return "Coordinación";
  }
  if (/(gasto|pago|transferencia|cuota|reintegro|documento|permiso|papeles|firma|viaje|vacaciones)/.test(source)) {
    return "Logística";
  }
  if (/(limite|límite|presion|presión|respeto|control|amenaz|agres)/.test(source)) {
    return "Límites";
  }
  return "Sin tema claro";
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
  currentStep: 1 | 2 | 3 | 4;
  labels: [string, string, string, string];
}) {
  const steps = [
    { id: 1, label: labels[0] },
    { id: 2, label: labels[1] },
    { id: 3, label: labels[2] },
    { id: 4, label: labels[3] },
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
export function WizardScaffold({
  preferredAdvisorId = null,
  resumeState = null,
  onExitToEntry,
}: {
  preferredAdvisorId?: string | null;
  resumeState?: ConversationResumeState | null;
  onExitToEntry?: () => void;
}) {
  const { activeConversation, ensureActiveConversation, updateSidebarConversation } = useMvpShell();
  const locale = resolveRuntimeLocale();
  const t = (key: string) => tRuntime(key, locale);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(resumeState?.targetStep ?? 1);
  const [stepOneInputMode, setStepOneInputMode] = useState<StepOneInputMode>("write");
  const [selectedDecision, setSelectedDecision] = useState<DecisionActionId>("no_reply");
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
  const persistedMessageKeysRef = useRef<Set<string>>(new Set());
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
    if (currentStep !== 1) return;
    if (activeConversation) return;
    void ensureActiveConversation({ advisorId: preferredAdvisorId });
  }, [activeConversation, currentStep, ensureActiveConversation, preferredAdvisorId]);

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
    const transcript = contextVoice.transcript.trim();
    if (!transcript) return;

    setMessageText((previous) => {
      const nextText = previous.trim() ? `${previous.trim()}\n${transcript}` : transcript;
      if (looksLikeConversationInput(nextText)) {
        window.setTimeout(() => {
          void interpretConversationText(nextText, "text");
        }, 0);
      }
      return nextText;
    });
    window.setTimeout(() => {
      const input = document.getElementById("wizard-primary-input") as HTMLTextAreaElement | null;
      input?.focus();
    }, 30);
    contextVoice.resetTranscript();
  }, [contextVoice.transcript, stepOneInputMode, contextVoice]);

  useEffect(() => {
    if (currentStep !== 3) {
      return;
    }
    const nextPrimaryDecisionId =
      getDecisionActions(getDecisionSignals(analysisResult, conversationBlocks, messageText)).find(
        (action) => action.id !== "advisor_help",
      )?.id ?? "advisor_help";
    setSelectedDecision(nextPrimaryDecisionId);
  }, [analysisResult, conversationBlocks, currentStep, advisorResult?.created_at, messageText]);

  useEffect(() => {
    if (currentStep !== 2) return;
    const container = conversationListRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [conversationBlocks, currentStep]);

  useEffect(() => {
    if (!speechSynthesis.speaking && speakingResponseIndex !== null) {
      setSpeakingResponseIndex(null);
    }
  }, [speakingResponseIndex, speechSynthesis.speaking]);

  useEffect(() => {
    if (currentStep !== 3) return;
    const visibleActions = getDecisionActions(getDecisionSignals(analysisResult, conversationBlocks, messageText));
    const actionStillVisible = visibleActions.some((action) => action.id === selectedDecision);
    if (actionStillVisible) return;
    const nextPrimaryDecisionId = visibleActions.find((action) => action.id !== "advisor_help")?.id ?? "advisor_help";
    setSelectedDecision(nextPrimaryDecisionId);
  }, [analysisResult, conversationBlocks, currentStep, messageText, selectedDecision]);

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

  async function refreshConversationTitle(params: {
    sourceText: string;
    analysisSummary: string;
  }) {
    const conversation = activeConversation ?? (await ensureActiveConversation({ advisorId: preferredAdvisorId }));
    if (!conversation) return;

    const normalizedCurrentTitle = conversation.title.trim().toLowerCase();
    const canUpdateTitle =
      conversation.titleStatus === "pending" ||
      normalizedCurrentTitle === "nueva conversacion" ||
      normalizedCurrentTitle === "sin tema claro";

    if (!canUpdateTitle) return;

    try {
      const updated = await patchConversation(conversation.id, {
        source_text: params.sourceText,
        case_title: activeCase?.title ?? undefined,
        analysis_summary: params.analysisSummary,
      });
      updateSidebarConversation(mapConversationSummaryToSidebar(updated));
    } catch {
      // Keep the analysis flow resilient if title refresh fails.
    }
  }

  async function persistConversationMessage(params: {
    role: "user" | "system" | "assistant";
    messageType: "source_text" | "analysis_action" | "selected_reply";
    content: string;
  }) {
    const normalizedContent = params.content.trim();
    if (!normalizedContent) return;

    const conversation = activeConversation ?? (await ensureActiveConversation({ advisorId: preferredAdvisorId }));
    if (!conversation) return;

    const key = `${conversation.id}:${params.messageType}`;
    if (persistedMessageKeysRef.current.has(key)) {
      return;
    }

    try {
      const persisted = await postMessage({
        conversation_id: conversation.id,
        role: params.role,
        content: normalizedContent,
        message_type: params.messageType,
      });
      persistedMessageKeysRef.current.add(`${persisted.conversation_id}:${persisted.message_type}`);
    } catch {
      // Keep UX resilient if minimal message persistence fails.
    }
  }

  function syncSidebarConversationSummary(sourceTextOverride?: string) {
    if (typeof window === "undefined") return;
    if (!sidebarConversationStartedAtRef.current) {
      sidebarConversationStartedAtRef.current = new Date().toISOString();
    }
    window.dispatchEvent(
      new CustomEvent("mvp:conversation-summary", {
        detail: {
          visible: true,
          title: buildSidebarConversationTitle(conversationBlocks, sourceTextOverride ?? messageText),
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

  async function runAnalysisForText(text: string, sourceType: "ocr" | "text") {
    if (!text || loadingAnalysis) return;
    setLoadingAnalysis(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setAnalysisId(null);

    try {
      await persistConversationMessage({
        role: "user",
        messageType: "source_text",
        content: text,
      });
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
      void refreshConversationTitle({
        sourceText: text,
        analysisSummary: result.summary,
      });
    } catch (exc) {
      setAnalysisError(toUiErrorMessage(exc, "No se pudo ejecutar el análisis."));
    } finally {
      setLoadingAnalysis(false);
    }
  }

  async function runAnalysis() {
    const text = getConversationSubmissionText(conversationBlocks, messageText);
    if (!text) return;
    await runAnalysisForText(text, ocrInfo ? "ocr" : "text");
  }

  async function requestAdvisorForText(
    text: string,
    params: {
      quickMode: boolean;
      analysisId?: string | null;
      sourceType: "ocr" | "text";
    },
  ) {
    if (!text || loadingAdvisor) return;
    syncSidebarConversationSummary(text);
    setLoadingAdvisor(true);
    setAdvisorError(null);
    setAdvisorResult(null);
    setCopiedIndex(null);

    try {
      await persistConversationMessage({
        role: "user",
        messageType: "source_text",
        content: text,
      });
      const result = await postAdvisor({
        message_text: text,
        mode,
        relationship_type: "otro",
        case_id: selectedCaseId ?? undefined,
        source_type: params.sourceType,
        quick_mode: params.quickMode,
        save_session: true,
        analysis_id: params.analysisId ?? undefined,
        context: buildContextPayload(),
      });
      setAdvisorResult(result);
      setCurrentStep(4);
    } catch (exc) {
      setAdvisorError(toUiErrorMessage(exc, "No se pudo generar respuestas de advisor."));
    } finally {
      setLoadingAdvisor(false);
    }
  }

  async function requestAdvisor(params: { quickMode: boolean; analysisId?: string | null }) {
    const text = getConversationSubmissionText(conversationBlocks, messageText);
    if (!text) return;
    await requestAdvisorForText(text, {
      ...params,
      sourceType: ocrInfo ? "ocr" : "text",
    });
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
    setAdvisorResult(null);
    setAdvisorError(null);

    if (conversationBlocks.length > 0) {
      setCurrentStep(2);
      return;
    }

    setCurrentStep(3);
    await runAnalysis();
  }

  async function handleContinueFromReviewStep() {
    setAnalysisResult(null);
    setAnalysisId(null);
    setAnalysisError(null);
    setCurrentStep(3);
    await runAnalysis();
  }

  async function handleContinueToStep4() {
    if (!analysisId) return;
    await requestAdvisor({ quickMode: false, analysisId });
  }

  async function handleResumeAnalysisFromSavedText() {
    const sourceText = resumeState?.sourceText?.trim();
    if (!sourceText) return;
    setConversationBlocks([]);
    setMessageText(sourceText);
    setStepOneInputMode("write");
    setOcrInfo(null);
    setOcrError(null);
    setOcrStatusMessage(null);
    setAutoParseError(null);
    setCurrentStep(3);
    await runAnalysisForText(sourceText, "text");
  }

  async function handleResumeAdvisorsFromSavedText() {
    const sourceText = resumeState?.sourceText?.trim();
    if (!sourceText) return;
    setConversationBlocks([]);
    setMessageText(sourceText);
    setStepOneInputMode("write");
    setOcrInfo(null);
    setOcrError(null);
    setOcrStatusMessage(null);
    setAutoParseError(null);
    setCurrentStep(4);
    await requestAdvisorForText(sourceText, {
      quickMode: false,
      sourceType: "text",
    });
  }

  function handleStartNewConversation() {
    setCurrentStep(1);
    setStepOneInputMode("write");
    setSelectedDecision("no_reply");
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
    persistedMessageKeysRef.current.clear();
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
      await persistConversationMessage({
        role: "assistant",
        messageType: "selected_reply",
        content: text,
      });
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
  const analysisQuickChips = analysisResult ? getAnalysisQuickChips(analysisResult) : [];
  const hasConversationInput = messageText.trim().length > 0 || conversationBlocks.length > 0;
  const replyTiming = analysisResult ? getReplyTimingGuidance(analysisResult) : null;
  const topicLabel = getSafeTopicLabel(activeCase?.title, conversationBlocks, messageText);
  const resumeSourcePreview = getResumePreviewText(resumeState?.sourceText ?? null);
  const resumeActionPreview = getResumePreviewText(resumeState?.analysisAction ?? null, 120);
  const resumeReplyPreview = getResumePreviewText(resumeState?.selectedReply ?? null);
  const showAnalysisResumePanel = Boolean(currentStep === 3 && resumeState?.sourceText && !analysisResult);
  const showAdvisorResumePanel = Boolean(
    currentStep === 4 && resumeState?.targetStep === 4 && !advisorResult,
  );
  const toneChipValue =
    analysisResult?.emotional_context.tone || analysisResult?.tone_detected || "No disponible";
  const urgencyChipValue =
    analysisQuickChips.find((chip) => chip.label === "Urgencia")?.value ??
    (analysisStatus?.kind === "risk" ? "Alta" : analysisStatus?.kind === "observation" ? "Media" : "Baja");
  const decisionActions = getDecisionActions(getDecisionSignals(analysisResult, conversationBlocks, messageText));
  const orderedDecisionActions = [...decisionActions].sort(
    (left, right) => DECISION_DISPLAY_ORDER[left.id] - DECISION_DISPLAY_ORDER[right.id],
  );
  const primaryDecisionId = orderedDecisionActions.find((action) => action.id !== "advisor_help")?.id ?? null;

  return (
    <Panel className={styles.wizardPanel}>
      <ShellStepper
        currentStep={currentStep}
        labels={["Entrada", "Revisión", "Análisis", "Consejeros"]}
      />

      {currentStep === 1 ? (
        <div className={`${styles.wizardStepBody} ${styles.wizardStepBodyScroll}`}>
          <div className={styles.wizardStepHeader}>
            <h3 className={styles.wizardStepIntroTitle}>¿Qué pasó?</h3>
            <p className={styles.wizardStepIntroCopy}>
              Escribí, subí una captura o dictá la conversación.
            </p>
            {caseError ? <p className="mt-2 text-xs text-red-700">{caseError}</p> : null}
          </div>

          <section className={`${styles.wizardMobileCard} ${styles.wizardStepOneCard}`} onPaste={handleStepOnePaste}>
            <div className={styles.wizardModeTabs}>
              <button
                type="button"
                onClick={() => setStepOneInputMode("write")}
                className={`${styles.wizardModeTab} ${stepOneInputMode === "write" ? styles.wizardModeTabActive : ""}`}
              >
                <span className={styles.wizardModeTabInner}>
                  <span className={styles.wizardModeTabIcon} aria-hidden="true">
                    <svg viewBox="0 0 20 20" className={styles.wizardModeTabSvg} fill="none">
                      <path
                        d="M4.5 13.75V16h2.25l7.9-7.9-2.25-2.25-7.9 7.9Zm9.15-8.9 1.25-1.25a1.06 1.06 0 0 1 1.5 0l.75.75a1.06 1.06 0 0 1 0 1.5l-1.25 1.25-2.25-2.25Z"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </span>
                  <span>Escribir</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStepOneInputMode("capture")}
                className={`${styles.wizardModeTab} ${stepOneInputMode === "capture" ? styles.wizardModeTabActive : ""}`}
              >
                <span className={styles.wizardModeTabInner}>
                  <span className={styles.wizardModeTabIcon} aria-hidden="true">
                    <svg viewBox="0 0 20 20" className={styles.wizardModeTabSvg} fill="none">
                      <path
                        d="M6.25 5.5h1.1l.85-1.25h3.6l.85 1.25h1.1a2 2 0 0 1 2 2v5.75a2 2 0 0 1-2 2h-7.5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M10 12.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </span>
                  <span>Captura</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStepOneInputMode("voice")}
                className={`${styles.wizardModeTab} ${stepOneInputMode === "voice" ? styles.wizardModeTabActive : ""}`}
              >
                <span className={styles.wizardModeTabInner}>
                  <span
                    className={`${styles.wizardModeTabIcon} ${styles.wizardModeTabVoiceIcon}`}
                    aria-hidden="true"
                  >
                    <span className={styles.wizardModeTabVoicePulse}>
                      <svg viewBox="0 0 20 20" className={styles.wizardModeTabSvg} fill="none">
                        <path
                          d="M10 3.75A2.25 2.25 0 0 0 7.75 6v3.25a2.25 2.25 0 1 0 4.5 0V6A2.25 2.25 0 0 0 10 3.75Z"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                        <path
                          d="M5.75 9a4.25 4.25 0 1 0 8.5 0M10 13.75v2.5m-2 0h4"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                      </svg>
                    </span>
                  </span>
                  <span className={styles.wizardTabLabel}>Voz</span>
                </span>
              </button>
            </div>

            {stepOneInputMode === "write" ? (
              <div className={styles.wizardInputGroup}>
                <div className={styles.wizardPanelTitleRow}>
                  <div>
                    <h4 className={styles.wizardPanelTitle}>Escribir</h4>
                    <p className={styles.wizardPanelHint}>Pegá el mensaje o contalo con tus palabras.</p>
                  </div>
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
                  id="wizard-primary-input"
                  value={messageText}
                  onChange={(event) => handleMessageTextChange(event.target.value)}
                  rows={6}
                  placeholder="Pegá el mensaje que recibiste o copiá la conversación completa."
                  spellCheck={false}
                  className={`${styles.wizardPrimaryTextarea} ${styles.wizardPrimaryTextareaCompact}`}
                />
              </div>
            ) : null}

            {stepOneInputMode === "capture" ? (
              <div className={styles.wizardInputGroup}>
                <div>
                  <h4 className={styles.wizardPanelTitle}>Captura</h4>
                  <p className={styles.wizardPanelHint}>Adjuntá una imagen y reutilizamos el OCR actual.</p>
                </div>
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
                  className={styles.wizardUploadCard}
                >
                  <span className={styles.wizardUploadIcon} aria-hidden="true">
                    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                      <path
                        d="M7.5 10.5 11 7a2.5 2.5 0 1 1 3.536 3.536l-5.657 5.657A4 4 0 1 1 3.222 10.536L9.586 4.17"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.7"
                      />
                    </svg>
                  </span>
                  <span>
                    <span className={styles.wizardUploadTitle}>Adjuntar captura de WhatsApp</span>
                    <span className={styles.wizardUploadCopy}>PNG, JPG o WebP. Luego puedes corregir el texto.</span>
                  </span>
                </button>
                <Textarea
                  id="wizard-primary-input"
                  value={messageText}
                  onChange={(event) => handleMessageTextChange(event.target.value)}
                  rows={5}
                  placeholder="Acá va a aparecer el texto extraído para que lo ajustes."
                  spellCheck={false}
                  className={`${styles.wizardPrimaryTextarea} ${styles.wizardPrimaryTextareaCompact}`}
                />
              </div>
            ) : null}

            {stepOneInputMode === "voice" ? (
              <div className={styles.wizardInputGroup}>
                <div>
                  <h4 className={styles.wizardPanelTitle}>Voz</h4>
                  <p className={styles.wizardPanelHint}>Tu dictado entra directo al texto principal.</p>
                </div>
                <div className={styles.wizardVoiceCaptureCard}>
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
                    className={`${styles.wizardVoiceCaptureButton} ${
                      contextVoice.listening ? styles.wizardVoiceCaptureButtonActive : ""
                    }`}
                    aria-label={contextVoice.listening ? "Detener dictado" : "Empezar dictado"}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
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
                  <div>
                    <p className={styles.wizardVoiceCaptureTitle}>
                      {contextVoice.listening ? "Escuchando..." : "Toca para dictar"}
                    </p>
                    <p className={styles.wizardVoiceCaptureCopy}>
                      {contextMicrophoneStatusMessage || "Tu voz se agregara al texto principal."}
                    </p>
                  </div>
                </div>
                <Textarea
                  id="wizard-primary-input"
                  value={messageText}
                  onChange={(event) => handleMessageTextChange(event.target.value)}
                  rows={6}
                  placeholder="Acá se va armando el dictado para que lo revises."
                  spellCheck={false}
                  className={`${styles.wizardPrimaryTextarea} ${styles.wizardPrimaryTextareaCompact}`}
                />
                {contextVoice.error ? (
                  <p className="text-[12px] text-[#92400e]">{getSpeechToTextErrorMessage(contextVoice.error)}</p>
                ) : null}
              </div>
            ) : null}

            <div className={styles.wizardStatusStack}>
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
          </section>

          <div className={`${styles.wizardStepActions} ${styles.wizardStepOneActions}`}>
            <div className={styles.wizardActionGroup}>
              <Button
                type="button"
                onClick={() => onExitToEntry?.()}
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
              {hasConversationInput ? (
                <Button
                  type="button"
                  onClick={handleStartNewConversation}
                  variant="secondary"
                  className={`${styles.wizardSecondaryButton} h-10 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
                >
                  Limpiar
                </Button>
              ) : null}
            </div>
            <div className={styles.wizardActionGroup}>
              <Button
                type="button"
                onClick={handleContinueFromStep1}
                disabled={
                  (!messageText.trim() && conversationBlocks.length === 0) ||
                  loadingAnalysis ||
                  autoParsing ||
                  ocrLoading
                }
                variant="primary"
                className={`${styles.wizardPrimaryButton} h-10 min-w-[148px] text-[13px] hover:bg-[#265cc7]`}
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
                {loadingAnalysis ? t("wizard.button.analyzing") : "Continuar"}
              </Button>
            </div>
          </div>
          {advisorError ? <p className="mt-2 text-sm text-red-700">{advisorError}</p> : null}
        </div>
      ) : null}
      {currentStep === 2 ? (
        <div className={`${styles.wizardStepBody} ${styles.wizardStepBodyPinned}`}>
          <div className={styles.wizardStepHeader}>
            <p className={styles.wizardStepKicker}>Paso 2</p>
            <h3 className={styles.wizardStepIntroTitle}>Revisión</h3>
            <p className={styles.wizardStepIntroCopy}>
              Corregí quién dijo qué antes de pasar al análisis.
            </p>
          </div>

          <section className={`${styles.wizardMobileCard} ${styles.wizardReviewCard}`}>
            <div ref={conversationListRef} className={styles.wizardConversationList}>
              {conversationBlocks.length === 0 ? (
                <p className={styles.wizardEmptyState}>
                  No detectamos bloques separados para revisar. Podés seguir directo al análisis.
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
                  <div className={styles.wizardBubbleHeader}>
                    <span className={styles.wizardBubbleSpeakerLabel}>{SPEAKER_LABELS[item.speaker]}</span>
                    <div className={styles.wizardSpeakerSwitch}>
                      <button
                        type="button"
                        onClick={() => updateConversationBlockSpeaker(item.id, "ex_partner")}
                        className={`${styles.wizardSpeakerOption} ${
                          item.speaker === "ex_partner" ? styles.wizardSpeakerOptionActiveIncoming : ""
                        }`}
                      >
                        Ex pareja
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConversationBlockSpeaker(item.id, "unknown")}
                        className={`${styles.wizardSpeakerOption} ${
                          item.speaker === "unknown" ? styles.wizardSpeakerOptionActiveUnknown : ""
                        }`}
                      >
                        Sin identificar
                      </button>
                      <button
                        type="button"
                        onClick={() => updateConversationBlockSpeaker(item.id, "user")}
                        className={`${styles.wizardSpeakerOption} ${
                          item.speaker === "user" ? styles.wizardSpeakerOptionActiveOutgoing : ""
                        }`}
                      >
                        Yo
                      </button>
                    </div>
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
          </section>

          <div className={`${styles.wizardFooterRow} ${styles.wizardReviewFooter}`}>
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
              onClick={() => void handleContinueFromReviewStep()}
              disabled={loadingAnalysis}
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
              {loadingAnalysis ? t("wizard.button.analyzing") : "Ver análisis"}
            </Button>
          </div>
        </div>
      ) : null}

      {currentStep === 3 ? (
        <div className={`${styles.wizardStepBody} ${styles.wizardStepBodyScroll}`}>
          <div className={styles.wizardStepHeader}>
            <p className={styles.wizardStepKicker}>Paso 3</p>
            <h3 className={styles.wizardStepIntroTitle}>Análisis</h3>
            <p className={styles.wizardStepIntroCopy}>
              Lo esencial para decidir si conviene responder, esperar o pedir ayuda.
            </p>
          </div>

          {showAnalysisResumePanel ? (
            <section className={`${styles.wizardMobileCard} ${styles.wizardResumeCard}`}>
              <div className={styles.wizardResumeHeader}>
                <div>
                  <p className={styles.wizardAnalysisBlockLabel}>ConversaciÃ³n guardada</p>
                  <p className={styles.wizardResumeTitle}>Retoma el anÃ¡lisis desde lo persistido</p>
                </div>
                <span className={styles.wizardResumeBadge}>Paso 3</span>
              </div>
              <p className={styles.wizardResumeCopy}>
                Entraste en el punto de anÃ¡lisis usando solo lo guardado. No rehidratamos todo el wizard.
              </p>
              {resumeActionPreview ? (
                <div className={styles.wizardResumeBlock}>
                  <p className={styles.wizardResumeLabel}>Ãšltima acciÃ³n guardada</p>
                  <p className={styles.wizardResumeValue}>{resumeActionPreview}</p>
                </div>
              ) : null}
              {resumeSourcePreview ? (
                <div className={styles.wizardResumeBlock}>
                  <p className={styles.wizardResumeLabel}>Texto base guardado</p>
                  <p className={styles.wizardResumeValue}>{resumeSourcePreview}</p>
                </div>
              ) : null}
              <div className={styles.wizardResumeActions}>
                <Button
                  type="button"
                  onClick={() => void handleResumeAnalysisFromSavedText()}
                  disabled={!resumeState?.sourceText || loadingAnalysis}
                  variant="primary"
                  className={`${styles.wizardPrimaryButton} h-10 min-w-[170px] text-[13px] hover:bg-[#265cc7]`}
                >
                  {loadingAnalysis ? "Analizando..." : "Analizar texto guardado"}
                </Button>
                <Button
                  type="button"
                  onClick={() => onExitToEntry?.()}
                  variant="secondary"
                  className={`${styles.wizardSecondaryButton} h-10 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
                >
                  Volver
                </Button>
              </div>
            </section>
          ) : null}

          <div className="min-h-6">
            {loadingAnalysis ? (
              <p className={styles.wizardStepStatus}>Interpretando contexto...</p>
            ) : null}
            {analysisError ? <p className="text-sm text-red-700">{analysisError}</p> : null}
            {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
          </div>

          {analysisResult ? (
            <>
              <div className={styles.wizardAnalysisLayout}>
                <div className={styles.wizardAnalysisColumn}>
                  <section className={`${styles.wizardMobileCard} ${styles.wizardAnalysisCompactCard}`}>
                    <div className={styles.wizardAnalysisCardHeader}>
                      <div className={styles.wizardAnalysisBlockLabel}>Recomendación principal</div>
                      <span
                        className={`${styles.wizardAnalysisDecisionBadge} ${
                          analysisStatus?.kind === "risk"
                            ? styles.wizardAnalysisDecisionBadgeRisk
                            : analysisStatus?.kind === "observation"
                              ? styles.wizardAnalysisDecisionBadgeWarn
                              : styles.wizardAnalysisDecisionBadgeOk
                        }`}
                      >
                        {analysisStatus?.kind === "risk"
                          ? "Pausa"
                          : analysisStatus?.kind === "observation"
                            ? "Cautela"
                            : "Estable"}
                      </span>
                    </div>
                    <div className={styles.wizardAnalysisSummaryStack}>
                      <p className={styles.wizardAnalysisDecisionTitle}>{replyTiming?.title}</p>
                      <p className={styles.wizardAnalysisDecisionText}>{replyTiming?.description}</p>
                    </div>
                  </section>

                  <section className={`${styles.wizardMobileCard} ${styles.wizardAnalysisCompactCard}`}>
                    <div className={styles.wizardAnalysisBlockLabel}>Qué está pasando</div>
                    <p className={styles.wizardAnalysisLongform}>{analysisResult.summary}</p>
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

                  <section className={`${styles.wizardMobileCard} ${styles.wizardAnalysisMetaCard}`}>
                    <div className={styles.wizardAnalysisBlockLabel}>Metadata</div>
                    <div className={styles.wizardAnalysisMetaGrid}>
                      <span className={`${styles.wizardAnalysisMetaItem} ${styles.wizardAnalysisMetaItemTone}`}>
                        <span className={styles.wizardAnalysisMetaLabel}>Tono</span>
                        <span className={styles.wizardAnalysisMetaValue}>{toneChipValue}</span>
                      </span>
                      <span className={`${styles.wizardAnalysisMetaItem} ${styles.wizardAnalysisMetaItemUrgency}`}>
                        <span className={styles.wizardAnalysisMetaLabel}>Urgencia</span>
                        <span className={styles.wizardAnalysisMetaValue}>{urgencyChipValue}</span>
                      </span>
                      <span className={`${styles.wizardAnalysisMetaItem} ${styles.wizardAnalysisMetaItemTopic}`}>
                        <span className={styles.wizardAnalysisMetaLabel}>Tema</span>
                        <span className={styles.wizardAnalysisMetaValue}>{topicLabel}</span>
                      </span>
                    </div>
                  </section>
                </div>

                <section className={`${styles.wizardMobileCard} ${styles.wizardAnalysisActionsCard}`}>
                  <div className={styles.wizardAnalysisBlockLabel}>Qué quieres hacer</div>
                  <div className={styles.wizardDecisionListCompact}>
                    {orderedDecisionActions.map((action) => {
                      const isAdvisorAction = action.id === "advisor_help";
                      const isActive = !isAdvisorAction && selectedDecision === action.id;
                      const isPrimaryAction = !isAdvisorAction && action.id === primaryDecisionId;

                      return (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => {
                            if (isAdvisorAction) {
                              void handleContinueToStep4();
                              return;
                            }
                            setSelectedDecision(action.id);
                            void persistConversationMessage({
                              role: "system",
                              messageType: "analysis_action",
                              content: action.title,
                            });
                          }}
                          className={`${styles.wizardDecisionOption} ${
                            isActive ? styles.wizardDecisionOptionActive : ""
                          } ${isAdvisorAction ? styles.wizardDecisionOptionAdvisor : ""} ${
                            isPrimaryAction ? styles.wizardDecisionOptionSuggested : ""
                          }`}
                          disabled={isAdvisorAction && (!analysisId || loadingAdvisor)}
                        >
                          <span className={styles.wizardDecisionTitle}>
                            {isAdvisorAction && loadingAdvisor ? "Cargando consejeros..." : action.title}
                          </span>
                          <span className={styles.wizardDecisionCopy}>{action.subtitle}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              <div className={styles.wizardFooterRow}>
                <Button
                  type="button"
                  onClick={() => setCurrentStep(conversationBlocks.length > 0 ? 2 : 1)}
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
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {currentStep === 4 ? (
        <div className={`${styles.wizardStepBody} ${styles.wizardStepBodyScroll}`}>
          <div className={styles.wizardStepHeader}>
            <p className={styles.wizardStepKicker}>Paso 4</p>
            <h3 className={styles.wizardStepIntroTitle}>Consejeros</h3>
            <p className={styles.wizardStepIntroCopy}>
              Elige con quien quieres profundizar. Esta pantalla reutiliza exactamente las cards actuales.
            </p>
          </div>

          {showAdvisorResumePanel ? (
            <section className={`${styles.wizardMobileCard} ${styles.wizardResumeCard}`}>
              <div className={styles.wizardResumeHeader}>
                <div>
                  <p className={styles.wizardAnalysisBlockLabel}>ConversaciÃ³n guardada</p>
                  <p className={styles.wizardResumeTitle}>Vuelve a consejeros desde lo guardado</p>
                </div>
                <span className={styles.wizardResumeBadge}>Paso 4</span>
              </div>
              <p className={styles.wizardResumeCopy}>
                Abrimos el punto de consejeros sin reconstruir el wizard completo. Si quieres, puedes generar
                de nuevo las respuestas desde el texto guardado.
              </p>
              {resumeReplyPreview ? (
                <div className={styles.wizardResumeBlock}>
                  <p className={styles.wizardResumeLabel}>Respuesta guardada</p>
                  <p className={styles.wizardResumeValue}>{resumeReplyPreview}</p>
                </div>
              ) : null}
              {resumeActionPreview ? (
                <div className={styles.wizardResumeBlock}>
                  <p className={styles.wizardResumeLabel}>Ãšltima acciÃ³n guardada</p>
                  <p className={styles.wizardResumeValue}>{resumeActionPreview}</p>
                </div>
              ) : null}
              {resumeSourcePreview ? (
                <div className={styles.wizardResumeBlock}>
                  <p className={styles.wizardResumeLabel}>Texto base guardado</p>
                  <p className={styles.wizardResumeValue}>{resumeSourcePreview}</p>
                </div>
              ) : null}
              <div className={styles.wizardResumeActions}>
                <Button
                  type="button"
                  onClick={() => void handleResumeAdvisorsFromSavedText()}
                  disabled={!resumeState?.sourceText || loadingAdvisor}
                  variant="primary"
                  className={`${styles.wizardPrimaryButton} h-10 min-w-[192px] text-[13px] hover:bg-[#265cc7]`}
                >
                  {loadingAdvisor ? "Generando..." : "Generar consejeros otra vez"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  variant="secondary"
                  className={`${styles.wizardSecondaryButton} h-10 text-[13px] hover:bg-[rgba(255,255,255,0.12)]`}
                >
                  Ir al anÃ¡lisis
                </Button>
              </div>
            </section>
          ) : null}

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
                  const isRecommended = preferredAdvisorId ? advisorVisual.id === preferredAdvisorId : index === 0;
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
                      className={`${styles.wizardAdvisorCard} ${isRecommended ? styles.wizardAdvisorCardRecommended : ""}`}
                    >
                      <header
                        className={`${styles.wizardAdvisorHeader} ${isRecommended ? styles.wizardAdvisorHeaderRecommended : ""}`}
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
                            {preferredAdvisorId ? "Tu consejero" : "Recomendada"}
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
                          className={`h-9 rounded-[12px] px-4 text-[13px] ${
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
                onClick={() => setCurrentStep(3)}
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


