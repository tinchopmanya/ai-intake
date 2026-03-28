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
import { getEmotionalCheckinToday } from "@/lib/api/client";
import { getConversationMessages } from "@/lib/api/client";
import { getConversations, postConversation } from "@/lib/api/client";
import { postAdvisorChat } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import type { EmotionalCheckinSummary } from "@/lib/api/types";
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

type SafeConversationEntry = {
  id: string;
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
};

type HistoricalReport = {
  totalCount: number;
  predominantTone: string;
  predominantRisk: string;
  topTopics: string[];
  recurringRecommendations: string[];
  globalSummary: string;
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
    };
  }

  const sourceText = sourceMessage?.content ?? "";
  return {
    id: conversation.id,
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

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const advisorDropdownRef = useRef<HTMLDivElement | null>(null);
  const createConversationPromiseRef = useRef<Promise<SidebarConversationSummary | null> | null>(null);
  const prefetchedConversationIdsRef = useRef<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [advisorMenuOpen, setAdvisorMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [displayName, setDisplayName] = useState("Usuario");
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
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
  const [conversationMessagesById, setConversationMessagesById] = useState<Record<string, MessageSummary[]>>({});
  const [todayCheckin, setTodayCheckin] = useState<EmotionalCheckinSummary | null>(null);
  const [historyReportOpen, setHistoryReportOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [sectionExpanded, setSectionExpanded] = useState<Record<HistorySectionKey, boolean>>({
    mood: true,
    advisor: true,
    ex: true,
  });
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

  useEffect(() => {
    let mounted = true;
    setConversationsLoading(true);
    void getConversations()
      .then((response) => {
        if (!mounted) return;
        setConversations(response.conversations.map(mapConversationSummary));
        setShellFetchNotice(null);
      })
      .catch((error) => {
        if (!mounted) return;
        setConversations([]);
        setShellFetchNotice(toUiErrorMessage(error, "No pudimos sincronizar las conversaciones por ahora."));
      })
      .finally(() => {
        if (!mounted) return;
        setConversationsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void getEmotionalCheckinToday()
      .then((response) => {
        if (!mounted) return;
        setTodayCheckin(response.today_checkin ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setTodayCheckin(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const visibleConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) => hasUsefulConversationContent(conversation) || conversation.id === activeConversationId,
      ),
    [activeConversationId, conversations],
  );

  const sidebarConversation = activeConversation ?? visibleConversations[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    const prefetchedIds = prefetchedConversationIdsRef.current;
    const targets = visibleConversations
      .filter((conversation) => hasUsefulConversationContent(conversation))
      .filter((conversation) => conversation.id !== activeConversationId)
      .filter((conversation) => conversationMessagesById[conversation.id] === undefined)
      .filter((conversation) => !prefetchedIds.has(conversation.id));

    targets.forEach((conversation) => {
      prefetchedIds.add(conversation.id);
      void getConversationMessages(conversation.id)
        .then((response) => {
          if (cancelled) return;
          setConversationMessagesById((previous) => ({
            ...previous,
            [conversation.id]: response.messages,
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setConversationMessagesById((previous) => ({
            ...previous,
            [conversation.id]: [],
          }));
        })
        .finally(() => {
          prefetchedIds.delete(conversation.id);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [activeConversationId, conversationMessagesById, visibleConversations]);

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

  useEffect(() => {
    if (!activeConversationId) return;
    setConversationMessagesById((previous) => ({
      ...previous,
      [activeConversationId]: activeConversationMessages,
    }));
  }, [activeConversationId, activeConversationMessages]);

  const initials = useMemo(() => {
    const parts = displayName
      .split(" ")
      .filter((part) => part.trim().length > 0)
      .slice(0, 2);
    if (parts.length === 0) return "U";
    return parts.map((part) => part[0]!.toUpperCase()).join("");
  }, [displayName]);

  const moodHistoryItems = useMemo(() => {
    if (!todayCheckin) return [];
    return [
      {
        id: todayCheckin.id,
        timestampLabel: formatHistoryTimestamp(todayCheckin.created_at),
        moodLabel: getMoodSummaryLabel(todayCheckin.mood_level) ?? "Sin definir",
        confidenceLabel: getConfidenceSummaryLabel(todayCheckin.confidence_level) ?? "Sin definir",
        recentContactLabel: todayCheckin.recent_contact ? "Si" : "No",
      },
    ];
  }, [todayCheckin]);

  const historicalEntries = useMemo(
    () =>
      visibleConversations
        .filter((conversation) => hasUsefulConversationContent(conversation))
        .map((conversation) =>
          buildSafeConversationEntry({
            conversation,
            messages:
              conversation.id === activeConversationId
                ? activeConversationMessages
                : (conversationMessagesById[conversation.id] ?? []),
            isActive: conversation.id === activeConversationId,
          }),
        )
        .sort((left, right) => right.timestampRaw.localeCompare(left.timestampRaw)),
    [activeConversationId, activeConversationMessages, conversationMessagesById, visibleConversations],
  );

  const advisorHistoryEntries = useMemo(
    () => historicalEntries.filter((entry) => entry.kind === "advisor"),
    [historicalEntries],
  );

  const exPartnerHistoryEntries = useMemo(
    () => historicalEntries.filter((entry) => entry.kind === "ex_partner"),
    [historicalEntries],
  );

  const historicalReport = useMemo(
    () => buildHistoricalReport(exPartnerHistoryEntries),
    [exPartnerHistoryEntries],
  );

  function toggleHistorySection(section: HistorySectionKey) {
    setSectionExpanded((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  }

  function handleSelectHistoryConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("mvp:conversation-selected", {
          detail: { conversationId },
        }),
      );
    }
    if (!isDesktop) setSidebarOpen(false);
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
  }, []);

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
          aria-label="Historico"
        >
          <div className={styles.shellSidebarHeader}>
            {sidebarOpen ? <span className={styles.shellSidebarTitle}>Historico</span> : <span />}
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
              <div className={styles.shellSidebarPrimaryAction}>
                <button
                  type="button"
                  className={styles.shellNewConversation}
                  onClick={() => {
                    setActiveConversationId(null);
                    if (typeof window !== "undefined") {
                      window.sessionStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
                      window.dispatchEvent(new Event("mvp:new-conversation"));
                    }
                    if (!isDesktop) setSidebarOpen(false);
                  }}
                >
                  <span className={styles.shellNewConversationIcon} aria-hidden="true">
                    +
                  </span>
                  Nueva conversacion
                </button>
              </div>
              <div className={styles.shellSidebarBody}>
                {shellFetchNotice ? <p className={styles.shellSidebarEmpty}>{shellFetchNotice}</p> : null}
                {conversationsLoading ? (
                  <p className={styles.shellSidebarEmpty}>Cargando conversaciones...</p>
                ) : historicalEntries.length > 0 || moodHistoryItems.length > 0 ? (
                  <div className={styles.shellHistoryList}>
                    <section className={styles.shellHistorySection}>
                      <button
                        type="button"
                        className={styles.shellHistorySectionToggle}
                        onClick={() => setHistoryExpanded((previous) => !previous)}
                        aria-expanded={historyExpanded}
                      >
                        <span className={styles.shellHistorySectionHeading}>Historico</span>
                        <span className={styles.shellHistorySectionMeta}>
                          {historicalEntries.length + moodHistoryItems.length} registro(s)
                        </span>
                      </button>

                      {historyExpanded ? (
                        <div className={styles.shellHistorySectionBody}>
                          <div className={styles.shellHistorySubsection}>
                            <button
                              type="button"
                              className={styles.shellHistorySubsectionToggle}
                              onClick={() => toggleHistorySection("mood")}
                              aria-expanded={sectionExpanded.mood}
                            >
                              <span>Estado de animo</span>
                              <span className={styles.shellHistoryCountPill}>{moodHistoryItems.length}</span>
                            </button>
                            {sectionExpanded.mood ? (
                              moodHistoryItems.length > 0 ? (
                                <div className={styles.shellHistoryItemList}>
                                  {moodHistoryItems.map((item) => (
                                    <article key={item.id} className={styles.shellHistoryItem}>
                                      <div className={styles.shellHistoryItemHeader}>
                                        <p className={styles.shellHistoryItemTitle}>Check-in diario</p>
                                        <span className={styles.shellHistoryItemTimestamp}>{item.timestampLabel}</span>
                                      </div>
                                      <div className={styles.shellHistoryMetricsGrid}>
                                        <div className={styles.shellHistoryMetric}>
                                          <span className={styles.shellHistoryMetricLabel}>Animo</span>
                                          <span className={styles.shellHistoryMetricValue}>{item.moodLabel}</span>
                                        </div>
                                        <div className={styles.shellHistoryMetric}>
                                          <span className={styles.shellHistoryMetricLabel}>Confianza</span>
                                          <span className={styles.shellHistoryMetricValue}>{item.confidenceLabel}</span>
                                        </div>
                                        <div className={styles.shellHistoryMetric}>
                                          <span className={styles.shellHistoryMetricLabel}>Contacto reciente</span>
                                          <span className={styles.shellHistoryMetricValue}>{item.recentContactLabel}</span>
                                        </div>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              ) : (
                                <p className={styles.shellSidebarEmpty}>Todavia no hay check-ins guardados.</p>
                              )
                            ) : null}
                          </div>

                          <div className={styles.shellHistorySubsection}>
                            <button
                              type="button"
                              className={styles.shellHistorySubsectionToggle}
                              onClick={() => toggleHistorySection("advisor")}
                              aria-expanded={sectionExpanded.advisor}
                            >
                              <span>Conversaciones con consejeros</span>
                              <span className={styles.shellHistoryCountPill}>{advisorHistoryEntries.length}</span>
                            </button>
                            {sectionExpanded.advisor ? (
                              advisorHistoryEntries.length > 0 ? (
                                <div className={styles.shellHistoryItemList}>
                                  {advisorHistoryEntries.map((entry) => (
                                    <button
                                      key={entry.id}
                                      type="button"
                                      className={`${styles.shellHistoryItemButton} ${
                                        entry.isActive ? styles.shellHistoryItemButtonActive : ""
                                      }`}
                                      onClick={() => handleSelectHistoryConversation(entry.id)}
                                    >
                                      <div className={styles.shellHistoryItemHeader}>
                                        <div>
                                          <p className={styles.shellHistoryItemTitle}>{entry.safeTitle}</p>
                                          <p className={styles.shellHistoryItemTimestamp}>{entry.timestampLabel}</p>
                                        </div>
                                        {entry.isActive ? (
                                          <span className={styles.shellSessionBadge}>Activa</span>
                                        ) : null}
                                      </div>
                                      <div className={styles.shellHistoryTagRow}>
                                        <span className={styles.shellHistoryTag}>Consejero: {entry.advisorName}</span>
                                        {entry.statusLabel ? (
                                          <span className={styles.shellHistoryTagMuted}>{entry.statusLabel}</span>
                                        ) : null}
                                      </div>
                                      <p className={styles.shellHistoryItemSummary}>{entry.safeSummary}</p>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className={styles.shellSidebarEmpty}>
                                  Todavia no hay conversaciones guiadas para mostrar.
                                </p>
                              )
                            ) : null}
                          </div>

                          <div className={styles.shellHistorySubsection}>
                            <button
                              type="button"
                              className={styles.shellHistorySubsectionToggle}
                              onClick={() => toggleHistorySection("ex")}
                              aria-expanded={sectionExpanded.ex}
                            >
                              <span>Conversaciones con expareja</span>
                              <span className={styles.shellHistoryCountPill}>{exPartnerHistoryEntries.length}</span>
                            </button>
                            {sectionExpanded.ex ? (
                              exPartnerHistoryEntries.length > 0 ? (
                                <>
                                  <div className={styles.shellHistoryItemList}>
                                    {exPartnerHistoryEntries.map((entry) => (
                                      <button
                                        key={entry.id}
                                        type="button"
                                        className={`${styles.shellHistoryItemButton} ${
                                          entry.isActive ? styles.shellHistoryItemButtonActive : ""
                                        }`}
                                        onClick={() => handleSelectHistoryConversation(entry.id)}
                                      >
                                        <div className={styles.shellHistoryItemHeader}>
                                          <div>
                                            <p className={styles.shellHistoryItemTitle}>{entry.safeTitle}</p>
                                            <p className={styles.shellHistoryItemTimestamp}>{entry.timestampLabel}</p>
                                          </div>
                                          {entry.isActive ? (
                                            <span className={styles.shellSessionBadge}>Activa</span>
                                          ) : null}
                                        </div>
                                        <div className={styles.shellHistoryTagRow}>
                                          {entry.originLabel ? (
                                            <span className={styles.shellHistoryTag}>Origen: {entry.originLabel}</span>
                                          ) : null}
                                          {entry.topicLabel ? (
                                            <span className={styles.shellHistoryTagMuted}>{entry.topicLabel}</span>
                                          ) : null}
                                        </div>
                                        <p className={styles.shellHistoryItemSummary}>{entry.safeSummary}</p>
                                        <div className={styles.shellHistoryMetaGrid}>
                                          <div className={styles.shellHistoryMetaItem}>
                                            <span className={styles.shellHistoryMetaLabel}>Tono</span>
                                            <span className={styles.shellHistoryMetaValue}>{entry.toneLabel}</span>
                                          </div>
                                          <div className={styles.shellHistoryMetaItem}>
                                            <span className={styles.shellHistoryMetaLabel}>Riesgo</span>
                                            <span className={styles.shellHistoryMetaValue}>{entry.riskLabel}</span>
                                          </div>
                                        </div>
                                        {entry.recommendationLabel ? (
                                          <p className={styles.shellHistoryRecommendation}>{entry.recommendationLabel}</p>
                                        ) : null}
                                      </button>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    className={styles.shellHistoryReportButton}
                                    onClick={() => setHistoryReportOpen(true)}
                                  >
                                    Ver informe historico
                                  </button>
                                </>
                              ) : (
                                <p className={styles.shellSidebarEmpty}>
                                  Todavia no hay intercambios con expareja listos para resumir.
                                </p>
                              )
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </section>
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
            </>
          ) : (
            <div className={styles.shellSidebarRail} />
          )}
        </aside>

        <section className={styles.shellContent}>{children}</section>
      </div>

      {historyReportOpen ? (
        <div className={styles.historyReportBackdrop} role="presentation" onClick={() => setHistoryReportOpen(false)}>
          <section
            className={styles.historyReportPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="historical-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.historyReportHeader}>
              <div>
                <p className={styles.historyReportEyebrow}>Informe historico</p>
                <h2 id="historical-report-title" className={styles.historyReportTitle}>
                  Interacciones consolidadas con expareja
                </h2>
              </div>
              <button
                type="button"
                className={styles.historyReportClose}
                aria-label="Cerrar informe historico"
                onClick={() => setHistoryReportOpen(false)}
              >
                ×
              </button>
            </div>

            {historicalReport ? (
              <div className={styles.historyReportBody}>
                <div className={styles.historyReportHero}>
                  <span className={styles.historyReportHeroPill}>{historicalReport.totalCount} caso(s) utiles</span>
                  <p className={styles.historyReportSummary}>{historicalReport.globalSummary}</p>
                </div>

                <div className={styles.historyReportGrid}>
                  <article className={styles.historyReportCard}>
                    <p className={styles.historyReportCardTitle}>Temas frecuentes</p>
                    <div className={styles.historyReportChipRow}>
                      {historicalReport.topTopics.length > 0 ? (
                        historicalReport.topTopics.map((topic) => (
                          <span key={topic} className={styles.historyReportChip}>
                            {topic}
                          </span>
                        ))
                      ) : (
                        <span className={styles.historyReportMuted}>Sin patron suficiente aun.</span>
                      )}
                    </div>
                  </article>

                  <article className={styles.historyReportCard}>
                    <p className={styles.historyReportCardTitle}>Tono habitual</p>
                    <p className={styles.historyReportLead}>{historicalReport.predominantTone}</p>
                    <p className={styles.historyReportMuted}>Etiqueta consolidada sin exponer mensajes literales.</p>
                  </article>

                  <article className={styles.historyReportCard}>
                    <p className={styles.historyReportCardTitle}>Riesgo predominante</p>
                    <p className={styles.historyReportLead}>{historicalReport.predominantRisk}</p>
                    <p className={styles.historyReportMuted}>Sirve para orientar la revision, no como diagnostico final.</p>
                  </article>

                  <article className={styles.historyReportCard}>
                    <p className={styles.historyReportCardTitle}>Recomendaciones recurrentes</p>
                    <div className={styles.historyReportRecommendationList}>
                      {historicalReport.recurringRecommendations.length > 0 ? (
                        historicalReport.recurringRecommendations.map((recommendation) => (
                          <p key={recommendation} className={styles.historyReportRecommendationItem}>
                            {recommendation}
                          </p>
                        ))
                      ) : (
                        <p className={styles.historyReportMuted}>Aun no hay recomendaciones repetidas para destacar.</p>
                      )}
                    </div>
                  </article>
                </div>
              </div>
            ) : (
              <p className={styles.shellSidebarEmpty}>Todavia no hay historial suficiente para consolidar.</p>
            )}
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
