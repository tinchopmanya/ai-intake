"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { MvpShellContextProvider } from "@/components/mvp/MvpShellContext";
import type { SidebarConversationSummary } from "@/components/mvp/MvpShellContext";
import styles from "@/components/mvp/MvpShell.module.css";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { getConversationMessages } from "@/lib/api/client";
import { getConversations, getMemoryItems, postConversation } from "@/lib/api/client";
import { postAdvisorChat } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import type { MemoryItemSummary } from "@/lib/api/types";
import type { MessageSummary } from "@/lib/api/types";
import { getCurrentUser, logoutSession } from "@/lib/auth/client";

type AppShellProps = {
  children: ReactNode;
};

const ACTIVE_CONVERSATION_STORAGE_KEY = "mvp-active-conversation-id";

const MOOD_LABELS = ["Muy agotado/a", "Con poco", "Normal", "Bastante bien", "Con fuerza"] as const;
const CONFIDENCE_LABELS = [
  "Dudando mucho",
  "Un poco inseguro/a",
  "Estable",
  "Bastante firme",
  "Muy firme",
] as const;

type HistorySectionKey = "mood" | "advisor" | "ex";

type MoodHistoryItem = {
  id: string;
  timestampLabel: string;
  moodLabel: string;
  confidenceLabel: string;
  recentContactLabel: string;
};

type SafeHistoryEntry = {
  id: string;
  conversationId: string | null;
  timestampLabel: string;
  timestampRaw: string;
  kind: "advisor" | "ex_partner";
  safeTitle: string;
  safeSummary: string;
  advisorName?: string | null;
  originLabel?: string | null;
  toneLabel?: string | null;
  riskLabel?: string | null;
  recommendationLabel?: string | null;
  topicLabel?: string | null;
  statusLabel?: string | null;
  isActive: boolean;
  isSensitive: boolean;
};

type SafeConversationEntry = SafeHistoryEntry;

type HistoricalReport = {
  totalCount: number;
  predominantTone: string;
  predominantRisk: string;
  topTopics: string[];
  recurringRecommendations: string[];
  globalSummary: string;
};

type ProcessSidebarItem = {
  id: string;
  section: HistorySectionKey;
  createdAt: string;
  dayLabel: string;
  timeLabel: string;
  safeTitle: string;
  safeSummary: string;
  toneValue: string | null;
  toneLabel: string;
  riskValue: string | null;
  riskLabel: string;
  recommendationLabel: string;
  isSensitive: boolean;
  advisorName?: string | null;
  moodLabel?: string;
  confidenceLabel?: string;
  recentContactLabel?: string;
};

type ProcessSidebarGroup = {
  label: string;
  items: ProcessSidebarItem[];
};

function getAdvisorAvatar(
  advisor: (typeof ADVISOR_PROFILES)[number] | undefined,
  variant: "64" | "128",
) {
  if (!advisor) return null;
  if (variant === "64") return advisor.avatar64 ?? advisor.avatar128 ?? null;
  return advisor.avatar128 ?? advisor.avatar64 ?? null;
}

function mapConversationSummary(
  conversation: Awaited<ReturnType<typeof postConversation>>,
): SidebarConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    titleStatus: conversation.title_status,
    advisorId: conversation.advisor_id,
    startedAt: conversation.created_at,
    lastMessageAt: conversation.last_message_at,
  };
}

function hasUsefulConversationContent(conversation: SidebarConversationSummary) {
  const normalizedTitle = conversation.title.trim().toLowerCase();
  const hasCustomTitle =
    normalizedTitle.length > 0 &&
    normalizedTitle !== "nueva conversacion" &&
    normalizedTitle !== "nueva conversación";
  const hasAdvancedTitleState = conversation.titleStatus !== "pending";
  const hasUpdatedTimestamp = conversation.lastMessageAt !== conversation.startedAt;
  return hasCustomTitle || hasAdvancedTitleState || hasUpdatedTimestamp;
}

function getConversationDisplayTitle(conversation: SidebarConversationSummary) {
  return conversation.title.trim().toLowerCase() === "nueva conversacion"
    ? "Nueva conversación"
    : conversation.title;
}

function getConversationMetaLabel(conversation: SidebarConversationSummary) {
  if (!hasUsefulConversationContent(conversation)) return "Borrador actual";
  const parsedDate = new Date(conversation.lastMessageAt);
  if (Number.isNaN(parsedDate.getTime())) return "Conversación reciente";
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function formatHistoryTimestamp(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function formatProcessTime(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "Sin hora";
  return new Intl.DateTimeFormat("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function getProcessDayLabel(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "Sin fecha";

  const currentDate = new Date();
  const currentStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const targetStart = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
  const dayDifference = Math.round((currentStart.getTime() - targetStart.getTime()) / 86400000);

  if (dayDifference === 0) return "Hoy";
  if (dayDifference === 1) return "Ayer";

  return new Intl.DateTimeFormat("es-UY", {
    day: "numeric",
    month: "short",
  }).format(parsedDate);
}

function groupProcessItems(items: ProcessSidebarItem[]) {
  const groups = new Map<string, ProcessSidebarGroup>();

  for (const item of items) {
    const existingGroup = groups.get(item.dayLabel);
    if (existingGroup) {
      existingGroup.items.push(item);
      continue;
    }
    groups.set(item.dayLabel, {
      label: item.dayLabel,
      items: [item],
    });
  }

  return [...groups.values()];
}

function getTextMetadataValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getAdvisorDisplayNameFromMemory(item: MemoryItemSummary) {
  const metadata = item.memory_metadata ?? {};
  const advisorName =
    getTextMetadataValue(metadata, "advisor_name") ??
    getTextMetadataValue(metadata, "advisor_label") ??
    getTextMetadataValue(metadata, "selected_advisor_name");
  if (advisorName) return advisorName;

  const advisorId =
    getTextMetadataValue(metadata, "advisor_id") ??
    getTextMetadataValue(metadata, "selected_advisor_id");
  if (!advisorId) return null;

  const advisor = ADVISOR_PROFILES.find((profile) => profile.id === advisorId.trim().toLowerCase());
  return advisor?.name ?? normalizeSafeLabel(advisorId, "Consejero");
}

function truncateCopy(value: string, maxLength: number) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function formatProcessDrawerHeaderDate(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-UY", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate).replace(",", " ·");
}

function getRiskLevelBucket(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "moderate";
  if (normalized === "low") return "low";
  if (normalized === "moderate") return "moderate";
  if (normalized === "high") return "high";
  if (normalized === "sensitive") return "high";
  return "moderate";
}

function getDrawerRiskBadgeLabel(value: string | null | undefined) {
  const riskBucket = getRiskLevelBucket(value);
  if (riskBucket === "low") return "Riesgo bajo";
  if (riskBucket === "high") return "Riesgo alto";
  return "Riesgo medio";
}

function getQuickReadingCopy(tone: string | null | undefined, risk: string | null | undefined) {
  const normalizedTone = tone?.trim().toLowerCase();
  const riskBucket = getRiskLevelBucket(risk);

  if (riskBucket === "low") {
    if (normalizedTone === "acompanado") {
      return "Esta fue una situacion de baja tension, con espacio para mirar lo que paso con mas perspectiva.";
    }
    if (normalizedTone === "firm") {
      return "Esta fue una situacion contenida, donde hizo falta firmeza sin entrar en conflicto abierto.";
    }
    return "Esta fue una situacion de baja tension, donde el foco estuvo mas en ordenar que en pelear.";
  }

  if (riskBucket === "high") {
    if (normalizedTone === "firm") {
      return "Esta fue una situacion delicada, donde sostener limites sin reaccionar de mas hace una gran diferencia.";
    }
    return "Esta fue una situacion sensible, con señales de que podria escalar si se responde desde la tension.";
  }

  if (normalizedTone === "neutral" || normalizedTone === "calm") {
    return "Esta fue una situacion intermedia, donde todavia hay margen para mantener claridad y evitar roces innecesarios.";
  }
  if (normalizedTone === "acompanado") {
    return "Esta fue una situacion que pide calma y criterio, mas que una respuesta inmediata.";
  }
  return "Esta fue una situacion con algo de tension, donde conviene priorizar claridad antes que reaccion.";
}

function getToneInterpretation(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "El tono se sintio contenido y sin señales claras de tension extra.";
  }
  if (normalized === "calm" || normalized === "neutral" || normalized === "supportive") {
    return "El tono fue sereno y no muestra una carga fuerte de confrontacion.";
  }
  if (normalized === "firm") {
    return "El tono fue firme, con necesidad de sostener limites sin entrar en mas desgaste.";
  }
  if (normalized === "acompanado") {
    return "El tono muestra busqueda de apoyo y una mirada mas reflexiva sobre lo que paso.";
  }
  return `El tono fue ${normalizeSafeLabel(normalized, "sereno").toLowerCase()} y ayuda a leer la situacion con mas perspectiva.`;
}

function getImportantInsightCopy(value: string | null | undefined) {
  const riskBucket = getRiskLevelBucket(value);
  if (riskBucket === "low") {
    return "No es un conflicto en si, sino una diferencia de enfoque que se puede ordenar bien.";
  }
  if (riskBucket === "high") {
    return "Es una situacion que puede escalar si no se maneja con cuidado.";
  }
  return "Hay potencial de malentendido si se responde impulsivamente.";
}

function humanizeRecommendation(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "En este caso, lo mejor seria bajar el ritmo y responder solo cuando tengas claro el foco.";
  }

  const lower = normalized.toLowerCase();
  if (
    lower.startsWith("mantener ") ||
    lower.startsWith("responder ") ||
    lower.startsWith("esperar ") ||
    lower.startsWith("revisar ") ||
    lower.startsWith("sostener ")
  ) {
    return `En tu lugar, ${lower}.`;
  }
  return `En tu lugar, lo mejor seria ${lower.charAt(0).toLowerCase()}${lower.slice(1)}.`;
}

function getLearningCopy(value: string | null | undefined) {
  const riskBucket = getRiskLevelBucket(value);
  if (riskBucket === "low") {
    return "Podes mantener este tipo de enfoque en situaciones similares.";
  }
  if (riskBucket === "high") {
    return "Es mejor pausar antes de responder y revisar el siguiente paso con calma.";
  }
  return "Conviene responder con cuidado para evitar escalar.";
}

function getMoodSummaryLabel(level: number | null | undefined) {
  return typeof level === "number" ? MOOD_LABELS[level] ?? null : null;
}

function getConfidenceSummaryLabel(level: number | null | undefined) {
  return typeof level === "number" ? CONFIDENCE_LABELS[level] ?? null : null;
}

function getLatestMessageByType(messages: MessageSummary[], messageType: MessageSummary["message_type"]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.message_type === messageType) {
      return message;
    }
  }
  return null;
}

function getSourceTextConversationTitle(sourceText: string) {
  const normalized = sourceText.toLowerCase();
  if (!normalized.trim()) return "Intercambio en revision";
  if (/(gasto|gastos|pago|pagos|dinero|plata|transferencia|cuota|reintegro|deuda)/.test(normalized)) {
    return "Diferencia por gastos";
  }
  if (/(visita|visitas|retiro|entrega|buscar|llevar|fin de semana)/.test(normalized)) {
    return "Coordinacion sobre visitas";
  }
  if (/(horario|horarios|hora|horas|turno|turnos|agenda|calendario)/.test(normalized)) {
    return "No acuerdo sobre horarios";
  }
  if (/(colegio|escuela|medico|doctor|vacuna|rutina|hijo|hija|hijos|familia)/.test(normalized)) {
    return "Consulta sobre organizacion familiar";
  }
  if (/(documento|documentos|permiso|papeles|firma|formulario)/.test(normalized)) {
    return "Consulta sobre documentacion";
  }
  if (/(vacaciones|viaje|viajes)/.test(normalized)) {
    return "Coordinacion de vacaciones";
  }
  return "Tema en revision";
}

function getSafeTopicLabel(sourceText: string, fallbackTitle: string) {
  const normalized = `${sourceText}\n${fallbackTitle}`.toLowerCase();
  if (!normalized.trim()) return "Sin tema claro";
  if (/(famil|hijo|hija|custodia|coparent|colegio|escuela|medico|vacuna)/.test(normalized)) {
    return "Tema familiar";
  }
  if (/(coordina|horario|agenda|turno|visita|retiro|entrega|fin de semana)/.test(normalized)) {
    return "Coordinacion";
  }
  if (/(gasto|pago|transferencia|cuota|reintegro|documento|permiso|papeles|firma|viaje|vacaciones)/.test(normalized)) {
    return "Logistica";
  }
  if (/(limite|presion|respeto|control|amenaz|agres)/.test(normalized)) {
    return "Limites";
  }
  return "Sin tema claro";
}

function inferConversationOrigin(sourceText: string, hasReplyDraft: boolean) {
  const normalized = sourceText.trim();
  if (!normalized && hasReplyDraft) return "Borrador propio";
  if (!normalized) return "Texto pegado";

  const lineCount = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  if (/\d{1,2}:\d{2}/.test(normalized) || lineCount >= 5) {
    return "Captura";
  }
  if (lineCount <= 2 && normalized.length <= 220) {
    return "Texto pegado";
  }
  return hasReplyDraft ? "Borrador propio" : "Texto pegado";
}

function getActionPresentation(actionTitle: string | null) {
  const normalized = actionTitle?.trim().toLowerCase() ?? "";
  if (normalized.includes("no responder")) {
    return {
      toneLabel: "Pausa estrategica",
      riskLabel: "Atencion elevada",
      recommendationLabel: "Mantener distancia y evitar reaccion inmediata.",
      statusLabel: "Decision tomada",
    };
  }
  if (normalized.includes("breve y neutro")) {
    return {
      toneLabel: "Neutral",
      riskLabel: "Bajo a moderado",
      recommendationLabel: "Responder solo con hechos y sin abrir frentes nuevos.",
      statusLabel: "Decision tomada",
    };
  }
  if (normalized.includes("limite")) {
    return {
      toneLabel: "Firme",
      riskLabel: "Moderado",
      recommendationLabel: "Sostener un limite claro y breve.",
      statusLabel: "Decision tomada",
    };
  }
  if (normalized.includes("mas tarde")) {
    return {
      toneLabel: "Cautela",
      riskLabel: "Moderado",
      recommendationLabel: "Esperar a bajar intensidad antes de responder.",
      statusLabel: "Decision tomada",
    };
  }
  if (normalized.includes("consejero")) {
    return {
      toneLabel: "Acompanamiento",
      riskLabel: "En observacion",
      recommendationLabel: "Revisar la decision con apoyo externo antes de enviar.",
      statusLabel: "Acompanado",
    };
  }
  return {
    toneLabel: "En revision",
    riskLabel: "Sin clasificar",
    recommendationLabel: "Volver sobre el caso solo si necesitas contexto.",
    statusLabel: "En proceso",
  };
}

function buildSafeConversationEntry(params: {
  conversation: SidebarConversationSummary;
  messages: MessageSummary[];
  isActive: boolean;
}): SafeConversationEntry {
  const { conversation, messages, isActive } = params;
  const sourceMessage = getLatestMessageByType(messages, "source_text");
  const analysisAction = getLatestMessageByType(messages, "analysis_action");
  const selectedReply = getLatestMessageByType(messages, "selected_reply");
  const actionPresentation = getActionPresentation(analysisAction?.content ?? null);
  const safeTimestamp = formatHistoryTimestamp(conversation.lastMessageAt);

  if (conversation.advisorId) {
    const advisor = ADVISOR_PROFILES.find((profile) => profile.id === conversation.advisorId);
    return {
      id: conversation.id,
      conversationId: conversation.id,
      timestampLabel: safeTimestamp,
      timestampRaw: conversation.lastMessageAt,
      kind: "advisor",
      safeTitle: `Sesion con ${advisor?.name ?? "consejero"}`,
      safeSummary: selectedReply
        ? "Quedo una respuesta afinada con acompanamiento, sin exponer el chat completo."
        : analysisAction
          ? "Se reviso una decision estrategica con apoyo guiado."
          : "Conversacion de apoyo para ordenar la situacion.",
      advisorName: advisor?.name ?? "Consejero",
      toneLabel: actionPresentation.toneLabel,
      riskLabel: actionPresentation.riskLabel,
      recommendationLabel: actionPresentation.recommendationLabel,
      statusLabel: actionPresentation.statusLabel,
      isActive,
      isSensitive: false,
    };
  }

  const sourceText = sourceMessage?.content ?? "";
  return {
    id: conversation.id,
    conversationId: conversation.id,
    timestampLabel: safeTimestamp,
    timestampRaw: conversation.lastMessageAt,
    kind: "ex_partner",
    safeTitle: getSourceTextConversationTitle(sourceText || conversation.title),
    safeSummary: selectedReply
      ? "Se trabajo una respuesta sugerida y quedo guardada para revisarla con calma."
      : analysisAction
        ? "Ya hay una accion elegida para responder con estrategia."
        : "Quedo un intercambio registrado para revisar sin mostrar texto literal.",
    originLabel: inferConversationOrigin(sourceText, Boolean(selectedReply)),
    toneLabel: actionPresentation.toneLabel,
    riskLabel: actionPresentation.riskLabel,
    recommendationLabel: actionPresentation.recommendationLabel,
    topicLabel: getSafeTopicLabel(sourceText, conversation.title),
    statusLabel: actionPresentation.statusLabel,
    isActive,
    isSensitive: false,
  };
}

function pickMostFrequent(values: Array<string | null | undefined>, fallback: string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return sorted[0]?.[0] ?? fallback;
}

function buildHistoricalReport(entries: SafeConversationEntry[]): HistoricalReport | null {
  if (entries.length === 0) return null;

  const topTopics = [...new Map(
    entries
      .filter((entry) => entry.topicLabel)
      .map((entry) => [entry.topicLabel as string, true]),
  ).keys()].slice(0, 3);
  const recurringRecommendations = [...new Map(
    entries
      .filter((entry) => entry.recommendationLabel)
      .map((entry) => [entry.recommendationLabel as string, true]),
  ).keys()].slice(0, 3);
  const predominantTone = pickMostFrequent(
    entries.map((entry) => entry.toneLabel),
    "En revision",
  );
  const predominantRisk = pickMostFrequent(
    entries.map((entry) => entry.riskLabel),
    "Sin clasificar",
  );
  const latestTimestamp = entries[0]?.timestampLabel ?? "sin fecha reciente";
  const leadingTopic = topTopics[0] ?? "temas en revision";

  return {
    totalCount: entries.length,
    predominantTone,
    predominantRisk,
    topTopics,
    recurringRecommendations,
    globalSummary: `ExReply ya registra ${entries.length} intercambio(s) revisado(s). Predominan ${leadingTopic.toLowerCase()} y un tono ${predominantTone.toLowerCase()}. Ultima actividad util: ${latestTimestamp}.`,
  };
}

function getNumberMetadataValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "number" ? value : null;
}

function getBooleanMetadataValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

function getAdvisorNameFromMemory(
  conversationId: string | null,
  conversations: SidebarConversationSummary[],
) {
  if (!conversationId) return "Consejero";
  const advisorId = conversations.find((conversation) => conversation.id === conversationId)?.advisorId;
  const advisor = ADVISOR_PROFILES.find((profile) => profile.id === advisorId);
  return advisor?.name ?? "Consejero";
}

function normalizeSafeLabel(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  const compact = normalized.replace(/[_-]+/g, " ");
  return compact.charAt(0).toUpperCase() + compact.slice(1);
}

function getSafeRiskLabel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "Sin clasificar";
  if (normalized === "low") return "Bajo";
  if (normalized === "moderate") return "Moderado";
  if (normalized === "high") return "Alto";
  if (normalized === "sensitive") return "Sensible";
  return normalizeSafeLabel(normalized, "Sin clasificar");
}

function getSafeToneLabel(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "En revision";
  if (normalized === "supportive") return "Sostén";
  if (normalized === "calm") return "Calma";
  if (normalized === "neutral") return "Neutral";
  if (normalized === "firm") return "Firme";
  if (normalized === "acompanado") return "Acompañado";
  return normalizeSafeLabel(normalized, "En revision");
}

function getSafeOriginLabel(sourceKind: MemoryItemSummary["source_kind"]) {
  if (sourceKind === "ex_chat_capture") return "Captura";
  if (sourceKind === "ex_chat_pasted") return "Texto pegado";
  if (sourceKind === "draft_analysis") return "Borrador propio";
  if (sourceKind === "advisor") return "Consejero";
  return "Check-in";
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const advisorDropdownRef = useRef<HTMLDivElement | null>(null);
  const createConversationPromiseRef = useRef<Promise<SidebarConversationSummary | null> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [advisorMenuOpen, setAdvisorMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [displayName, setDisplayName] = useState("Usuario");
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatDebugPayload, setAdvisorChatDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);
  const [conversations, setConversations] = useState<SidebarConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationMessages, setActiveConversationMessages] = useState<MessageSummary[]>([]);
  const [activeConversationMessagesLoading, setActiveConversationMessagesLoading] = useState(false);
  const [memoryItems, setMemoryItems] = useState<MemoryItemSummary[]>([]);
  const [memoryItemsLoading, setMemoryItemsLoading] = useState(true);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [sectionExpanded, setSectionExpanded] = useState<Record<HistorySectionKey, boolean>>({
    mood: true,
    advisor: true,
    ex: true,
  });
  const [selectedProcessItem, setSelectedProcessItem] = useState<ProcessSidebarItem | null>(null);
  const [shellFetchNotice, setShellFetchNotice] = useState<string | null>(null);
  const speechSynthesis = useSpeechSynthesis({ lang: "es-ES" });

  useEffect(() => {
    let mounted = true;
    void getCurrentUser().then((user) => {
      if (!mounted || !user) return;
      const resolvedName = (user.name || user.email || "Usuario").trim();
      setDisplayName(resolvedName || "Usuario");
    });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const response = await getConversations();
      setConversations(response.conversations.map(mapConversationSummary));
      setShellFetchNotice(null);
    } catch (error) {
      setConversations([]);
      setShellFetchNotice(toUiErrorMessage(error, "No pudimos sincronizar las conversaciones por ahora."));
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  const refreshMemoryItems = useCallback(async () => {
    setMemoryItemsLoading(true);
    try {
      const response = await getMemoryItems({ limit: 100 });
      setMemoryItems(
        [...response.items].sort((left, right) => right.created_at.localeCompare(left.created_at)),
      );
      setHistoryNotice(null);
    } catch (error) {
      setMemoryItems([]);
      setHistoryNotice(toUiErrorMessage(error, "No pudimos sincronizar el histórico seguro por ahora."));
    } finally {
      setMemoryItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
    void refreshMemoryItems();
  }, [refreshConversations, refreshMemoryItems]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = (matches: boolean) => {
      setIsDesktop(matches);
      setSidebarOpen(matches);
    };
    sync(media.matches);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (target && advisorDropdownRef.current && !advisorDropdownRef.current.contains(target)) {
        setAdvisorMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setAdvisorMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", onDocumentClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDocumentClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleMemoryUpdated() {
      void refreshMemoryItems();
    }

    window.addEventListener("mvp:memory-updated", handleMemoryUpdated);
    return () => window.removeEventListener("mvp:memory-updated", handleMemoryUpdated);
  }, [refreshMemoryItems]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const usefulConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) => hasUsefulConversationContent(conversation) || conversation.id === activeConversationId,
      ),
    [activeConversationId, conversations],
  );
  const visibleConversations = usefulConversations;

  const sidebarConversation = activeConversation ?? usefulConversations[0] ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeConversationId) {
      window.sessionStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      return;
    }
    const persistedConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
    if (!persistedConversation || !hasUsefulConversationContent(persistedConversation)) {
      window.sessionStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, activeConversationId);
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeConversationId || conversations.length === 0) return;
    const storedConversationId = window.sessionStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    if (!storedConversationId) return;
    const persistedConversation =
      conversations.find((conversation) => conversation.id === storedConversationId) ?? null;
    if (!persistedConversation || !hasUsefulConversationContent(persistedConversation)) {
      window.sessionStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      return;
    }
    setActiveConversationId(persistedConversation.id);
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (!activeConversationId) {
      setActiveConversationMessages([]);
      setActiveConversationMessagesLoading(false);
      return;
    }

    let cancelled = false;
    setActiveConversationMessagesLoading(true);
    void getConversationMessages(activeConversationId)
      .then((response) => {
        if (cancelled) return;
        setActiveConversationMessages(response.messages);
        setShellFetchNotice(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("conversation_messages_load_failed", error);
        setActiveConversationMessages([]);
        setShellFetchNotice(toUiErrorMessage(error, "No pudimos cargar el detalle de la conversación."));
      })
      .finally(() => {
        if (cancelled) return;
        setActiveConversationMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  const initials = useMemo(() => {
    const parts = displayName
      .split(" ")
      .filter((part) => part.trim().length > 0)
      .slice(0, 2);
    if (parts.length === 0) return "U";
    return parts.map((part) => part[0]!.toUpperCase()).join("");
  }, [displayName]);

  const moodHistoryItems = useMemo(() => {
    return memoryItems
      .filter((item) => item.memory_type === "mood_checkin")
      .map((item) => {
        const metadata = item.memory_metadata ?? {};
        const moodLevel = getNumberMetadataValue(metadata, "mood_level");
        const confidenceLevel = getNumberMetadataValue(metadata, "confidence_level");
        const recentContact = getBooleanMetadataValue(metadata, "recent_contact");
        return {
          id: item.id,
          section: "mood",
          createdAt: item.created_at,
          dayLabel: getProcessDayLabel(item.created_at),
          timeLabel: formatProcessTime(item.created_at),
          safeTitle: item.safe_title,
          safeSummary: item.safe_summary,
          toneValue: item.tone,
          toneLabel: getSafeToneLabel(item.tone),
          riskValue: item.risk_level,
          riskLabel: getSafeRiskLabel(item.risk_level),
          recommendationLabel: item.recommended_next_step ?? "Seguir registrando como evoluciona el dia.",
          isSensitive: item.is_sensitive,
          moodLabel: getMoodSummaryLabel(moodLevel) ?? "Sin definir",
          confidenceLabel: getConfidenceSummaryLabel(confidenceLevel) ?? "Sin definir",
          recentContactLabel: recentContact === null ? "Sin dato" : recentContact ? "Si" : "No",
        } satisfies ProcessSidebarItem;
      });
  }, [memoryItems]);

  const exPartnerHistoryEntries = useMemo(
    () =>
      memoryItems
        .filter((item) => item.memory_type === "coparenting_exchange_summary")
        .map((item) => ({
          id: item.id,
          section: "ex",
          createdAt: item.created_at,
          dayLabel: getProcessDayLabel(item.created_at),
          timeLabel: formatProcessTime(item.created_at),
          safeTitle: item.safe_title,
          safeSummary: item.safe_summary,
          toneValue: item.tone,
          toneLabel: getSafeToneLabel(item.tone),
          riskValue: item.risk_level,
          riskLabel: getSafeRiskLabel(item.risk_level),
          recommendationLabel:
            item.recommended_next_step ?? "Volver sobre esta situacion cuando necesites decidir con mas calma.",
          isSensitive: item.is_sensitive,
        } satisfies ProcessSidebarItem))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [memoryItems],
  );

  const advisorHistoryEntries = useMemo(
    () =>
      memoryItems
        .filter((item) => item.memory_type === "advisor_session_summary")
        .map((item) => ({
          id: item.id,
          section: "advisor",
          createdAt: item.created_at,
          dayLabel: getProcessDayLabel(item.created_at),
          timeLabel: formatProcessTime(item.created_at),
          safeTitle: item.safe_title,
          safeSummary: item.safe_summary,
          toneValue: item.tone,
          toneLabel: getSafeToneLabel(item.tone),
          riskValue: item.risk_level,
          riskLabel: getSafeRiskLabel(item.risk_level),
          recommendationLabel:
            item.recommended_next_step ?? "Volver a este consejo cuando quieras revisar tu siguiente paso.",
          isSensitive: item.is_sensitive,
          advisorName: getAdvisorDisplayNameFromMemory(item),
        } satisfies ProcessSidebarItem))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [memoryItems],
  );

  const groupedMoodHistory = useMemo(() => groupProcessItems(moodHistoryItems), [moodHistoryItems]);
  const groupedExPartnerHistory = useMemo(() => groupProcessItems(exPartnerHistoryEntries), [exPartnerHistoryEntries]);
  const groupedAdvisorHistory = useMemo(() => groupProcessItems(advisorHistoryEntries), [advisorHistoryEntries]);
  const totalVisibleProcessItems = moodHistoryItems.length + exPartnerHistoryEntries.length;

  useEffect(() => {
    if (!selectedProcessItem) return;

    const refreshedItem = [...moodHistoryItems, ...exPartnerHistoryEntries, ...advisorHistoryEntries].find(
      (item) => item.id === selectedProcessItem.id,
    );
    if (!refreshedItem) {
      setSelectedProcessItem(null);
      return;
    }
    setSelectedProcessItem(refreshedItem);
  }, [advisorHistoryEntries, exPartnerHistoryEntries, moodHistoryItems, selectedProcessItem]);

  function handleSelectProcessItem(item: ProcessSidebarItem) {
    setSelectedProcessItem(item);
    if (!isDesktop) setSidebarOpen(false);
  }

  function closeProcessDetail() {
    setSelectedProcessItem(null);
  }

  const selectedProcessSectionLabel = useMemo(() => {
    if (!selectedProcessItem) return "";
    if (selectedProcessItem.section === "mood") return "Como estas";
    if (selectedProcessItem.section === "ex") return "Situaciones analizadas";
    return "Consejos recibidos";
  }, [selectedProcessItem]);

  const selectedProcessTimestampLabel = useMemo(() => {
    if (!selectedProcessItem) return "";
    return formatProcessDrawerHeaderDate(selectedProcessItem.createdAt);
  }, [selectedProcessItem]);

  const selectedProcessInterpretation = useMemo(() => {
    if (!selectedProcessItem) return "";
    return getQuickReadingCopy(selectedProcessItem.toneValue, selectedProcessItem.riskValue);
  }, [selectedProcessItem]);

  const selectedProcessImportantInsight = useMemo(() => {
    if (!selectedProcessItem) return "";
    return `${getImportantInsightCopy(selectedProcessItem.riskValue)} ${getToneInterpretation(selectedProcessItem.toneValue)}`;
  }, [selectedProcessItem]);

  const selectedProcessLearning = useMemo(() => {
    if (!selectedProcessItem) return "";
    return getLearningCopy(selectedProcessItem.riskValue);
  }, [selectedProcessItem]);

  const selectedProcessRecommendation = useMemo(() => {
    if (!selectedProcessItem) return "";
    return humanizeRecommendation(selectedProcessItem.recommendationLabel);
  }, [selectedProcessItem]);

  const selectedProcessRiskBadgeLabel = useMemo(() => {
    if (!selectedProcessItem) return "";
    return getDrawerRiskBadgeLabel(selectedProcessItem.riskValue);
  }, [selectedProcessItem]);

  const selectedProcessRiskBadgeClassName = useMemo(() => {
    if (!selectedProcessItem) return styles.processDrawerRiskBadgeModerate;
    const riskBucket = getRiskLevelBucket(selectedProcessItem.riskValue);
    if (riskBucket === "low") return styles.processDrawerRiskBadgeLow;
    if (riskBucket === "high") return styles.processDrawerRiskBadgeHigh;
    return styles.processDrawerRiskBadgeModerate;
  }, [selectedProcessItem]);

  function toggleHistorySection(section: HistorySectionKey) {
    setSectionExpanded((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  }

  const findReusableDraftConversation = useCallback(
    (advisorId?: string | null) =>
      conversations.find((conversation) => {
        if (conversation.titleStatus !== "pending") return false;
        if (conversation.title.trim().toLowerCase() !== "nueva conversacion") return false;
        if (!advisorId) return true;
        return conversation.advisorId === advisorId;
      }) ?? null,
    [conversations],
  );

  const createSidebarConversation = useCallback(
    async (options?: { advisorId?: string | null }) => {
      const reusableDraft = findReusableDraftConversation(options?.advisorId ?? null);
      if (reusableDraft) {
        setActiveConversationId(reusableDraft.id);
        return reusableDraft;
      }

      if (createConversationPromiseRef.current) {
        return createConversationPromiseRef.current;
      }

      const pendingPromise = (async () => {
        try {
          const created = mapConversationSummary(
            await postConversation({
              advisor_id: options?.advisorId ?? undefined,
            }),
          );
          setConversations((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
          setActiveConversationId(created.id);
          return created;
        } catch (error) {
          console.error("sidebar_conversation_create_failed", error);
          return null;
        } finally {
          createConversationPromiseRef.current = null;
        }
      })();

      createConversationPromiseRef.current = pendingPromise;
      return pendingPromise;
    },
    [findReusableDraftConversation],
  );

  const updateSidebarConversation = useCallback((conversation: SidebarConversationSummary) => {
    setConversations((previous) =>
      previous.map((item) => (item.id === conversation.id ? { ...item, ...conversation } : item)),
    );
    void refreshMemoryItems();
  }, [refreshMemoryItems]);

  const upsertActiveConversationMessage = useCallback((message: MessageSummary) => {
    setActiveConversationMessages((previous) => {
      const nextMessages = previous.filter((item) => item.id !== message.id);
      nextMessages.push(message);
      nextMessages.sort((left, right) => left.created_at.localeCompare(right.created_at));
      return nextMessages;
    });
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === message.conversation_id
          ? {
              ...conversation,
              lastMessageAt: message.created_at,
            }
          : conversation,
      ),
    );
  }, []);

  const ensureActiveConversation = useCallback(
    async (options?: { advisorId?: string | null }) => {
      if (activeConversation) return activeConversation;
      return createSidebarConversation(options);
    },
    [activeConversation, createSidebarConversation],
  );

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  function handleSelectAdvisor(index: number) {
    setAdvisorMenuOpen(false);
    setAdvisorChatIndex(index);
    setAdvisorChatInput("");
    setAdvisorChatDebugPayload(null);
    setAdvisorChatMessages([]);
    setAdvisorChatOpen(true);
  }

  function openAdvisorConversation(advisorId: string) {
    const advisorIndex = ADVISOR_PROFILES.findIndex((advisor) => advisor.id === advisorId);
    handleSelectAdvisor(advisorIndex >= 0 ? advisorIndex : 0);
  }

  async function handleSendAdvisorMessage() {
    if (advisorChatIndex === null || advisorChatSending || !advisorChatInput.trim()) return;
    const userInput = advisorChatInput.trim();
    const advisor = ADVISOR_PROFILES[advisorChatIndex];
    const outboundMessages = [
      ...advisorChatMessages.map((item) => ({
        role: item.role,
        content: item.text,
      })),
      {
        role: "user" as const,
        content: userInput,
      },
    ];
    const advisorPayload = {
      advisor_id: advisor?.id ?? "laura",
      entry_mode: "advisor_conversation" as const,
      messages: outboundMessages,
      conversation_context: {
        user_name: displayName,
      },
      debug: process.env.NODE_ENV !== "production",
    };
    if (process.env.NODE_ENV !== "production") {
      const debugPayload = {
        endpoint: "/v1/advisor/chat",
        entryMode: "advisor_conversation",
        advisor: advisor
          ? {
              id: advisor.id,
              name: advisor.name,
              role: advisor.role,
            }
          : null,
        userInput,
        payload: advisorPayload,
      };
      setAdvisorChatDebugPayload(debugPayload);
      console.debug("advisor_prompt_debug", debugPayload);
    }
    setAdvisorChatSending(true);
    try {
      const result = await postAdvisorChat(advisorPayload);
      const reply = result.message || "No se pudo generar una respuesta en este momento.";
      setAdvisorChatMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: userInput },
        { id: `a-${Date.now() + 1}`, role: "advisor", text: reply },
      ]);
      if (speechSynthesis.supported && reply.trim()) {
        speechSynthesis.speak(reply);
      }
      setAdvisorChatInput("");
      if (process.env.NODE_ENV !== "production") {
        setAdvisorChatDebugPayload((previous) => ({
          ...(previous ?? {}),
          response: result,
          response_preview: reply.slice(0, 500),
        }));
      }
    } catch (error) {
      const reply = toUiErrorMessage(error, "No pude responder ahora. Intenta nuevamente.");
      setAdvisorChatMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: userInput },
        {
          id: `a-err-${Date.now()}`,
          role: "advisor",
          text: reply,
        },
      ]);
    } finally {
      setAdvisorChatSending(false);
    }
  }

  function handleVoiceAdvisorSessionSync(payload: {
    turns: Array<{ role: "user" | "advisor"; text: string }>;
    lastSuggestedReply: string | null;
    debug?: Record<string, unknown> | null;
  }) {
    if (payload.turns.length === 0) return;
    const newTurns = payload.turns.map((turn, index) => ({
      id: `v-sync-${Date.now()}-${index}`,
      role: turn.role,
      text: turn.text,
    }));
    setAdvisorChatMessages((prev) => [...prev, ...newTurns]);
    const latestAdvisorText =
      [...payload.turns].reverse().find((turn) => turn.role === "advisor")?.text ?? "";
    if (speechSynthesis.supported && latestAdvisorText.trim()) {
      speechSynthesis.speak(latestAdvisorText);
    }
    if (process.env.NODE_ENV !== "production") {
      setAdvisorChatDebugPayload((previous) => ({
        ...(previous ?? {}),
        voice_response: payload,
        endpoint: "/v1/advisor/voice",
      }));
    }
  }

  return (
    <MvpShellContextProvider
      value={{
        displayName,
        initials,
        sidebarConversation,
        activeConversation,
        activeConversationMessages,
        activeConversationMessagesLoading,
        ensureActiveConversation,
        createSidebarConversation,
        updateSidebarConversation,
        upsertActiveConversationMessage,
        setActiveConversationId,
        openAdvisorConversation,
      }}
    >
      <main className={styles.shellRoot}>
      <header className={styles.shellTopbar}>
        <div className={styles.shellBrand}>
          <span className={styles.shellBrandAccent} aria-hidden="true" />
          <span>ExReply</span>
        </div>
        <div className={styles.shellActions}>
          <div ref={advisorDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setAdvisorMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={advisorMenuOpen}
              className={styles.shellAdvisorTrigger}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className={styles.shellAdvisorTriggerIcon} fill="none">
                <path
                  d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5v1.25A3.25 3.25 0 0 1 4 12v.5h12V12a3.25 3.25 0 0 1-1.5-2.75V8A4.5 4.5 0 0 0 10 3.5Zm0 12.75a2.2 2.2 0 0 0 2.02-1.33H7.98A2.2 2.2 0 0 0 10 16.25Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.4"
                />
              </svg>
              Hablar con un advisor
            </button>
            {advisorMenuOpen ? (
              <div role="menu" className={`absolute right-0 z-20 mt-2 w-[340px] ${styles.shellDropdownPanel}`}>
                <ul className={styles.shellAdvisorList}>
                  {ADVISOR_PROFILES.map((advisor, index) => {
                    const dropdownAvatarSrc = getAdvisorAvatar(advisor, "64");
                    const advisorInitials = advisor.name
                      .split(" ")
                      .filter((part) => part.trim().length > 0)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() ?? "")
                      .join("");
                    return (
                      <li key={advisor.id}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => handleSelectAdvisor(index)}
                          className={styles.shellAdvisorItem}
                        >
                          {dropdownAvatarSrc ? (
                            <Image
                              src={dropdownAvatarSrc}
                              alt={advisor.name}
                              width={42}
                              height={42}
                              className={styles.shellAdvisorAvatar}
                            />
                          ) : (
                            <span className={styles.shellAdvisorFallback}>{advisorInitials || "AD"}</span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={styles.shellAdvisorName}>{advisor.name}</p>
                            <p className={styles.shellAdvisorDescription}>{advisor.description}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={styles.shellUserButton}
              title={displayName}
              aria-label={displayName}
            >
              {initials}
            </button>
            {menuOpen ? (
              <div role="menu" className={`absolute right-0 z-20 mt-2 ${styles.shellUserMenu}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/onboarding?edit=1");
                  }}
                  role="menuitem"
                  className={styles.shellUserMenuItem}
                >
                  Editar mis datos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleLogout();
                  }}
                  role="menuitem"
                  className={styles.shellUserMenuItem}
                >
                  Cerrar sesion
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className={styles.shellWorkspace}>
        {!isDesktop && sidebarOpen ? (
          <button
            type="button"
            aria-label="Cerrar sidebar"
            className={styles.shellMobileBackdrop}
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <aside
          className={`${styles.shellSidebar} ${sidebarOpen ? styles.shellSidebarExpanded : ""}`}
          aria-label="Tu proceso"
        >
          <div className={styles.shellSidebarHeader}>
            {sidebarOpen ? <span className={styles.shellSidebarTitle}>Tu proceso</span> : <span />}
            <button
              type="button"
              className={styles.shellSidebarToggle}
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label={sidebarOpen ? "Colapsar sidebar" : "Expandir sidebar"}
              aria-expanded={sidebarOpen}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={`${styles.shellSidebarChevron} ${sidebarOpen ? styles.shellSidebarChevronOpen : ""}`}
                fill="none"
              >
                <path
                  d="m7 4 6 6-6 6"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>

          {sidebarOpen ? (
            <>
              <div className={styles.shellSidebarBody}>
                {shellFetchNotice ? <p className={styles.shellSidebarEmpty}>{shellFetchNotice}</p> : null}
                {historyNotice ? <p className={styles.shellSidebarEmpty}>{historyNotice}</p> : null}
                {conversationsLoading || memoryItemsLoading ? (
                  <p className={styles.shellSidebarEmpty}>Cargando tu proceso...</p>
                ) : totalVisibleProcessItems > 0 ? (
                  <div className={styles.processPanel}>
                    <section className={styles.processSection}>
                      <button
                        type="button"
                        className={styles.processSectionToggle}
                        onClick={() => toggleHistorySection("mood")}
                        aria-expanded={sectionExpanded.mood}
                      >
                        <div className={styles.processSectionLead}>
                          <span className={`${styles.processSectionIcon} ${styles.processSectionIconMood}`} aria-hidden="true">
                            <svg viewBox="0 0 20 20" className={styles.processSectionIconSvg} fill="none">
                              <path
                                d="M10 16.25s-4.75-2.95-4.75-7.05A2.7 2.7 0 0 1 8 6.5c.84 0 1.63.39 2 .99.37-.6 1.16-.99 2-.99a2.7 2.7 0 0 1 2.75 2.7c0 4.1-4.75 7.05-4.75 7.05Z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <div>
                            <p className={styles.processSectionTitle}>Check-ins diarios</p>
                            <p className={styles.processSectionCopy}>Cómo te venís sintiendo y si hubo contacto.</p>
                          </div>
                        </div>
                        <div className={styles.processSectionMeta}>
                          <span className={styles.shellHistoryCountPill}>{moodHistoryItems.length}</span>
                          <span
                            className={`${styles.processSectionChevron} ${
                              sectionExpanded.mood ? styles.processSectionChevronOpen : ""
                            }`}
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 20 20" className={styles.processSectionChevronSvg} fill="none">
                              <path
                                d="m7 4 6 6-6 6"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </div>
                      </button>
                      {sectionExpanded.mood ? (
                        groupedMoodHistory.length > 0 ? (
                          <div className={styles.processSectionBody}>
                            {groupedMoodHistory.map((group) => (
                              <div key={group.label} className={styles.processDateGroup}>
                                <p className={styles.processDateLabel}>{group.label}</p>
                                <div className={styles.processItemList}>
                                  {group.items.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className={`${styles.processItemCard} ${
                                        selectedProcessItem?.id === item.id ? styles.processItemSelected : ""
                                      }`}
                                      onClick={() => handleSelectProcessItem(item)}
                                    >
                                      <div className={styles.processItemHeader}>
                                        <div>
                                          <p className={styles.processItemTitle}>Registro diario emocional</p>
                                          <p className={styles.processItemMeta}>{item.dayLabel} · {item.timeLabel}</p>
                                        </div>
                                        <span className={styles.processItemArrow} aria-hidden="true">
                                          ›
                                        </span>
                                      </div>
                                      <div className={styles.processMoodGrid}>
                                        <div className={styles.processMetricCard}>
                                          <span className={styles.processMetricLabel}>Animo</span>
                                          <span className={styles.processMetricValue}>{item.moodLabel}</span>
                                        </div>
                                        <div className={styles.processMetricCard}>
                                          <span className={styles.processMetricLabel}>Confianza</span>
                                          <span className={styles.processMetricValue}>{item.confidenceLabel}</span>
                                        </div>
                                        <div className={styles.processMetricCard}>
                                          <span className={styles.processMetricLabel}>Contacto reciente</span>
                                          <span className={styles.processMetricValue}>{item.recentContactLabel}</span>
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={styles.shellSidebarEmpty}>Todavia no hay registros emocionales guardados.</p>
                        )
                      ) : null}
                    </section>

                    <section className={styles.processSection}>
                      <button
                        type="button"
                        className={styles.processSectionToggle}
                        onClick={() => toggleHistorySection("ex")}
                        aria-expanded={sectionExpanded.ex}
                      >
                        <div className={styles.processSectionLead}>
                          <span className={`${styles.processSectionIcon} ${styles.processSectionIconEx}`} aria-hidden="true">
                            <svg viewBox="0 0 20 20" className={styles.processSectionIconSvg} fill="none">
                              <path
                                d="M4.75 5.75h10.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H9.8L6.2 16.6a.75.75 0 0 1-1.2-.6v-2.25H4.75a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5Z"
                                stroke="currentColor"
                                strokeWidth="1.55"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <div>
                            <p className={styles.processSectionTitle}>Situaciones analizadas</p>
                            <p className={styles.processSectionCopy}>Lecturas seguras para decidir con más claridad.</p>
                          </div>
                        </div>
                        <div className={styles.processSectionMeta}>
                          <span className={styles.shellHistoryCountPill}>{exPartnerHistoryEntries.length}</span>
                          <span
                            className={`${styles.processSectionChevron} ${
                              sectionExpanded.ex ? styles.processSectionChevronOpen : ""
                            }`}
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 20 20" className={styles.processSectionChevronSvg} fill="none">
                              <path
                                d="m7 4 6 6-6 6"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </div>
                      </button>
                      {sectionExpanded.ex ? (
                        groupedExPartnerHistory.length > 0 ? (
                          <div className={styles.processSectionBody}>
                            {groupedExPartnerHistory.map((group) => (
                              <div key={group.label} className={styles.processDateGroup}>
                                <p className={styles.processDateLabel}>{group.label}</p>
                                <div className={styles.processItemList}>
                                  {group.items.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className={`${styles.processItemCard} ${styles.processItemInteractive} ${
                                        selectedProcessItem?.id === item.id ? styles.processItemSelected : ""
                                      }`}
                                      onClick={() => handleSelectProcessItem(item)}
                                    >
                                      <div className={styles.processItemHeader}>
                                        <div>
                                          <p className={styles.processItemTitle}>{item.safeTitle}</p>
                                          <p className={styles.processItemMeta}>{item.dayLabel} · {item.timeLabel}</p>
                                        </div>
                                        <span className={styles.processItemArrow} aria-hidden="true">
                                          ›
                                        </span>
                                      </div>
                                      <div className={styles.processItemTagRow}>
                                        <span className={styles.processRiskBadge}>{item.riskLabel}</span>
                                        <span className={styles.processActionHint}>Ver evolucion</span>
                                      </div>
                                      <p className={styles.processRecommendationPreview}>{item.recommendationLabel}</p>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={styles.shellSidebarEmpty}>Todavia no hay situaciones analizadas para mostrar.</p>
                        )
                        ) : null}
                    </section>

                    {false ? (
                      <section className={styles.processSection}>
                        <button
                          type="button"
                          className={styles.processSectionToggle}
                          onClick={() => toggleHistorySection("advisor")}
                          aria-expanded={sectionExpanded.advisor}
                        >
                        <div>
                          <p className={styles.processSectionTitle}>Consejos recibidos</p>
                          <p className={styles.processSectionCopy}>Recomendaciones guardadas para volver cuando las necesites.</p>
                        </div>
                        <span className={styles.shellHistoryCountPill}>{advisorHistoryEntries.length}</span>
                      </button>
                      {sectionExpanded.advisor ? (
                        groupedAdvisorHistory.length > 0 ? (
                          <div className={styles.processSectionBody}>
                            {groupedAdvisorHistory.map((group) => (
                              <div key={group.label} className={styles.processDateGroup}>
                                <p className={styles.processDateLabel}>{group.label}</p>
                                <div className={styles.processItemList}>
                                  {group.items.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className={`${styles.processItemCard} ${
                                        selectedProcessItem?.id === item.id ? styles.processItemSelected : ""
                                      }`}
                                      onClick={() => handleSelectProcessItem(item)}
                                    >
                                      <div className={styles.processItemHeader}>
                                        <div>
                                          <p className={styles.processItemTitle}>{item.safeTitle}</p>
                                          <p className={styles.processItemMeta}>{item.dayLabel} · {item.timeLabel}</p>
                                        </div>
                                        <span className={styles.processItemArrow} aria-hidden="true">
                                          ›
                                        </span>
                                      </div>
                                      {item.advisorName ? (
                                        <p className={styles.processAdvisorLabel}>Con {item.advisorName}</p>
                                      ) : null}
                                      <p className={styles.processSummaryPreview}>{truncateCopy(item.safeSummary, 120)}</p>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={styles.shellSidebarEmpty}>Todavia no hay consejos guardados para revisar.</p>
                        )
                      ) : null}
                      </section>
                    ) : null}
                  </div>
                ) : false ? (
                  <div className={styles.shellSessionList}>
                    {visibleConversations.map((conversation) => {
                      const isActive = conversation.id === activeConversationId;
                      const isDraft = !hasUsefulConversationContent(conversation);
                      const metaLabel = getConversationMetaLabel(conversation);
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          className={`${styles.shellSessionItem} ${
                            isActive ? styles.shellSessionActive : ""
                          } ${isDraft ? styles.shellSessionDraft : ""}`}
                          onClick={() => {
                            setActiveConversationId(conversation.id);
                            if (typeof window !== "undefined") {
                              window.dispatchEvent(
                                new CustomEvent("mvp:conversation-selected", {
                                  detail: { conversationId: conversation.id },
                                }),
                              );
                            }
                          }}
                        >
                          <div className={styles.shellSessionRow}>
                            <p className={styles.shellSessionTitle}>{getConversationDisplayTitle(conversation)}</p>
                            {isActive ? (
                              <span className={styles.shellSessionBadge}>Activa</span>
                            ) : null}
                          </div>
                          <p className={styles.shellSessionMeta}>{metaLabel}</p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles.shellSidebarEmpty}>Todavía no tienes conversaciones guardadas.</p>
                )}
              </div>
              <div className={styles.shellSidebarFooter}>
                <button
                  type="button"
                  className={styles.shellSidebarSettingsButton}
                  onClick={() => setSettingsModalOpen(true)}
                >
                  <span className={styles.shellSidebarSettingsIcon} aria-hidden="true">
                    <svg viewBox="0 0 20 20" className={styles.shellSidebarSettingsSvg} fill="none">
                      <path
                        d="M8.3 4.15a1 1 0 0 1 1.4-.8l.54.23a1 1 0 0 0 .8 0l.54-.23a1 1 0 0 1 1.4.8l.1.58a1 1 0 0 0 .55.72l.52.26a1 1 0 0 1 .44 1.55l-.36.48a1 1 0 0 0 0 .86l.36.48a1 1 0 0 1-.44 1.55l-.52.26a1 1 0 0 0-.55.72l-.1.58a1 1 0 0 1-1.4.8l-.54-.23a1 1 0 0 0-.8 0l-.54.23a1 1 0 0 1-1.4-.8l-.1-.58a1 1 0 0 0-.55-.72l-.52-.26a1 1 0 0 1-.44-1.55l.36-.48a1 1 0 0 0 0-.86l-.36-.48a1 1 0 0 1 .44-1.55l.52-.26a1 1 0 0 0 .55-.72l.1-.58Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M11.75 10a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className={styles.shellSidebarSettingsCopy}>
                    <span className={styles.shellSidebarSettingsTitle}>Configuración</span>
                    <span className={styles.shellSidebarSettingsHint}>Preferencias y acciones de cuenta</span>
                  </span>
                </button>
              </div>
            </>
          ) : (
            <div className={styles.shellSidebarRail} />
          )}
        </aside>

        <section className={styles.shellContent}>{children}</section>
      </div>

      {selectedProcessItem ? (
        <div className={styles.historyReportBackdrop} role="presentation" onClick={closeProcessDetail}>
          <section
            className={styles.historyReportPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="process-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.historyReportHeader}>
              <div className={styles.processDrawerHeaderContent}>
                <p className={styles.historyReportEyebrow}>Tu proceso</p>
                <div className={styles.processDrawerMetaRow}>
                  <span className={styles.processDrawerDateLabel}>Fecha · {selectedProcessTimestampLabel}</span>
                  <span className={`${styles.processDrawerRiskBadge} ${selectedProcessRiskBadgeClassName}`}>
                    {selectedProcessRiskBadgeLabel}
                  </span>
                </div>
                <h2 id="process-detail-title" className={styles.processDrawerHeading}>
                  {selectedProcessSectionLabel}
                </h2>
              </div>
              <button
                type="button"
                className={styles.historyReportClose}
                aria-label="Cerrar detalle"
                onClick={closeProcessDetail}
              >
                ×
              </button>
            </div>

            <div className={styles.historyReportBody}>
              <section className={styles.processDrawerBlock}>
                <p className={styles.processDrawerBlockTitle}>Qué pasó</p>
                {selectedProcessItem.section === "advisor" && selectedProcessItem.advisorName ? (
                  <p className={styles.processDrawerInlineNote}>Lo revisaste con {selectedProcessItem.advisorName}.</p>
                ) : null}
                <h3 className={styles.processDrawerContextTitle}>{selectedProcessItem.safeTitle}</h3>
                <p className={styles.processDrawerContextCopy}>{selectedProcessItem.safeSummary}</p>
              </section>

              <section className={styles.processDrawerBlock}>
                <p className={styles.processDrawerBlockTitle}>Lectura rápida</p>
                <div className={styles.processDrawerInterpretationCard}>
                  <p className={styles.processDrawerBodyCopy}>{selectedProcessInterpretation}</p>
                </div>
              </section>

              <section className={styles.processDrawerBlock}>
                <p className={styles.processDrawerBlockTitle}>Lo importante aquí</p>
                <div className={styles.processDrawerInsightCard}>
                  <p className={styles.processDrawerBodyCopy}>{selectedProcessImportantInsight}</p>
                </div>
              </section>

              <section className={styles.processDrawerBlock}>
                <p className={styles.processDrawerBlockTitle}>Qué haría en tu lugar</p>
                <div className={styles.processDrawerRecommendationCard}>
                  <p className={styles.processDrawerRecommendationCopy}>{selectedProcessRecommendation}</p>
                </div>
              </section>

              <section className={styles.processDrawerBlock}>
                <p className={styles.processDrawerBlockTitle}>Si te vuelve a pasar algo así</p>
                <div className={styles.processDrawerLearningCard}>
                  <p className={styles.processDrawerBodyCopy}>{selectedProcessLearning}</p>
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {settingsModalOpen ? (
        <div
          className={styles.historyReportBackdrop}
          role="presentation"
          onClick={() => setSettingsModalOpen(false)}
        >
          <section
            className={styles.settingsModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.historyReportHeader}>
              <div className={styles.processDrawerHeaderContent}>
                <p className={styles.historyReportEyebrow}>Configuración</p>
                <h2 id="settings-modal-title" className={styles.processDrawerHeading}>
                  Ajustes de tu proceso
                </h2>
                <p className={styles.processDrawerContextCopy}>
                  Acá vamos a concentrar preferencias y acciones sensibles sin sacarte del flujo principal.
                </p>
              </div>
              <button
                type="button"
                className={styles.historyReportClose}
                aria-label="Cerrar configuración"
                onClick={() => setSettingsModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.settingsModalBody}>
              <section className={styles.settingsActionCard}>
                <div className={styles.settingsActionCopyBlock}>
                  <p className={styles.settingsActionEyebrow}>Historial</p>
                  <h3 className={styles.settingsActionTitle}>Borrar historial</h3>
                  <p className={styles.settingsActionText}>
                    Esta acción va a quedar disponible cuando exista soporte completo del backend para limpiar la memoria segura.
                  </p>
                </div>
                <button type="button" disabled className={styles.settingsActionButton}>
                  Próximamente
                </button>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      <AdvisorChatModal
        isOpen={advisorChatOpen}
        advisorId={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.id : undefined}
        advisorName={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.name ?? "Adviser" : "Adviser"}
        advisorRole={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.role ?? "" : ""}
        advisorDescription={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.description ?? "" : ""}
        userName={displayName}
        advisorAvatarSrc={
          advisorChatIndex !== null
            ? getAdvisorAvatar(ADVISOR_PROFILES[advisorChatIndex], "128")
            : null
        }
        messages={advisorChatMessages}
        draft={advisorChatInput}
        sending={advisorChatSending}
        entryMode="advisor_conversation"
        onDraftChange={setAdvisorChatInput}
        onSend={() => void handleSendAdvisorMessage()}
        onUseResponse={() => setAdvisorChatOpen(false)}
        onClose={() => setAdvisorChatOpen(false)}
        helperCopy={`Como estas hoy, ${displayName}? En que te puedo ayudar?`}
        debugPayload={advisorChatDebugPayload}
        autoSendOnVoiceComplete
        onVoiceSessionSync={handleVoiceAdvisorSessionSync}
      />
      </main>
    </MvpShellContextProvider>
  );
}
