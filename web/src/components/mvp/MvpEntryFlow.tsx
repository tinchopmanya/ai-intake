"use client";

import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/mvp/MvpEntryFlow.module.css";
import { useMvpShell } from "@/components/mvp/MvpShellContext";
import { WizardScaffold, type ConversationResumeState } from "@/components/mvp/WizardScaffold";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { getEmotionalCheckinToday, postEmotionalCheckin } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import type { MessageSummary } from "@/lib/api/types";
import type { EmotionalCheckinSummary } from "@/lib/api/types";

type FlowView = "entry" | "wizard";
type SelectorIntent = "vent" | "write_to_ex";
type SelectorCardVariant = "calm" | "structured" | "direct";
type ResumeCta = ConversationResumeState & {
  ctaLabel: string;
  helperText: string;
  previewText: string | null;
};
type HistoryEntry = {
  id: string;
  label: string;
  content: string;
  timestamp: string;
};

type CheckinOption = {
  value: number;
  label: string;
};

const DEFAULT_ADVISOR_STORAGE_KEY = "exreply-default-advisor-id";
const WIZARD_VIEW_STORAGE_KEY = "mvp-wizard-view";

const DAILY_MOOD_OPTIONS: CheckinOption[] = [
  { value: 0, label: "Muy agotado/a" },
  { value: 1, label: "Con poco" },
  { value: 2, label: "Normal" },
  { value: 3, label: "Bastante bien" },
  { value: 4, label: "Con fuerza" },
];

const DAILY_CONFIDENCE_OPTIONS: CheckinOption[] = [
  { value: 0, label: "Dudando mucho" },
  { value: 1, label: "Un poco inseguro/a" },
  { value: 2, label: "Estable" },
  { value: 3, label: "Bastante firme" },
  { value: 4, label: "Muy firme" },
];

const EX_RELATIONSHIP_OPTIONS: CheckinOption[] = [
  { value: 1, label: "Demasiado conflictivo" },
  { value: 2, label: "Tenso pero sin conflicto" },
  { value: 3, label: "Neutro" },
  { value: 4, label: "Mejorando" },
  { value: 5, label: "En paz" },
];

const CHILDREN_INTERACTION_OPTIONS: CheckinOption[] = [
  { value: 1, label: "Muy difícil" },
  { value: 2, label: "Con tensión" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Tranquila" },
  { value: 5, label: "Muy bien" },
];

const ADVISOR_MICROCOPY: Record<string, string> = {
  laura: "Espacio breve para bajar intensidad y ordenar lo que sientes.",
  robert: "Mirada clara para poner foco y recuperar perspectiva.",
  lidia: "Acompañamiento concreto para descargar sin dar más vueltas.",
};

const ADVISOR_STYLE_LABEL: Record<string, string> = {
  laura: "Escucha primero",
  robert: "Limites claros",
  lidia: "Al grano",
};

const ADVISOR_CARD_VARIANT: Record<string, SelectorCardVariant> = {
  laura: "calm",
  robert: "structured",
  lidia: "direct",
};

function getGreetingLabel() {
  const hour = new Date().getHours();
  if (hour < 12) return "Buen día";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function getFirstName(displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) return "Usuario";
  return trimmed.split(" ")[0] || "Usuario";
}

function formatLastSession(startedAt: string) {
  const parsed = new Date(startedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  const isSameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();
  if (isSameDay) return "hoy";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    parsed.getFullYear() === yesterday.getFullYear() &&
    parsed.getMonth() === yesterday.getMonth() &&
    parsed.getDate() === yesterday.getDate();
  if (isYesterday) return "ayer";

  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
  }).format(parsed);
}

function readStoredAdvisorId() {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(DEFAULT_ADVISOR_STORAGE_KEY);
  return ADVISOR_PROFILES.some((advisor) => advisor.id === stored) ? stored : null;
}

function getMoodSummaryLabel(level: number | null | undefined) {
  return DAILY_MOOD_OPTIONS.find((option) => option.value === level)?.label ?? null;
}

function getConfidenceSummaryLabel(level: number | null | undefined) {
  return DAILY_CONFIDENCE_OPTIONS.find((option) => option.value === level)?.label ?? null;
}

function getRelationshipSummaryLabel(level: number | null | undefined) {
  return EX_RELATIONSHIP_OPTIONS.find((option) => option.value === level)?.label ?? null;
}

function getChildrenInteractionSummaryLabel(level: number | null | undefined) {
  return CHILDREN_INTERACTION_OPTIONS.find((option) => option.value === level)?.label ?? null;
}

function getMessageTypeLabel(messageType: MessageSummary["message_type"]) {
  if (messageType === "analysis_action") return "Acción elegida";
  if (messageType === "selected_reply") return "Respuesta seleccionada";
  return "Texto original guardado";
}

function getMessagePreview(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93)}...`;
}

function getSavedItemsLabel(count: number) {
  if (count === 1) return "1 elemento guardado";
  return `${count} elementos guardados`;
}

function getLatestMessageContent(
  messages: MessageSummary[],
  messageType: MessageSummary["message_type"],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.message_type === messageType) {
      return message.content.trim() || null;
    }
  }
  return null;
}

function buildResumeCta(messages: MessageSummary[]): ResumeCta | null {
  const sourceText = getLatestMessageContent(messages, "source_text");
  const analysisAction = getLatestMessageContent(messages, "analysis_action");
  const selectedReply = getLatestMessageContent(messages, "selected_reply");

  if (selectedReply) {
    return {
      targetStep: 4,
      sourceText,
      analysisAction,
      selectedReply,
      ctaLabel: "Volver a consejeros",
      helperText: "Volver al punto de consejeros con tu respuesta guardada a mano.",
      previewText: getMessagePreview(selectedReply),
    };
  }

  if (analysisAction) {
    return {
      targetStep: 3,
      sourceText,
      analysisAction,
      selectedReply: null,
      ctaLabel: "Seguir desde el análisis",
      helperText: `Última acción guardada: ${analysisAction}.`,
      previewText: sourceText ? getMessagePreview(sourceText) : getMessagePreview(analysisAction),
    };
  }

  if (sourceText) {
    return {
      targetStep: 3,
      sourceText,
      analysisAction: null,
      selectedReply: null,
      ctaLabel: "Retomar análisis",
      helperText: "Tienes texto guardado y puedes continuar sin reconstruir el flujo completo.",
      previewText: getMessagePreview(sourceText),
    };
  }

  return null;
}

function formatMessageTimestamp(createdAt: string) {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function buildHistoryEntries(messages: MessageSummary[]): HistoryEntry[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      id: message.id,
      label: getMessageTypeLabel(message.message_type),
      content: message.content.trim(),
      timestamp: formatMessageTimestamp(message.created_at),
    }));
}

function getCheckinPercent(level: number | null | undefined) {
  if (level === null || level === undefined) return 0;
  return ((level + 1) / DAILY_MOOD_OPTIONS.length) * 100;
}

function getCheckinTone(level: number | null | undefined) {
  if (level === null || level === undefined) return "steady";
  if (level <= 1) return "low";
  if (level >= 3) return "high";
  return "steady";
}

function getRecentContactSummary(value: boolean | null | undefined) {
  if (value === true) return "Hubo contacto reciente";
  if (value === false) return "Sin contacto reciente";
  return "Sin registrar";
}

function TodayStateMetric({
  label,
  value,
  percent,
  tone,
  icon,
}: {
  label: string;
  value: string;
  percent: number;
  tone: "low" | "steady" | "high";
  icon: ReactNode;
}) {
  const toneClassName =
    tone === "low"
      ? styles.todayStateLow
      : tone === "high"
        ? styles.todayStateHigh
        : styles.todayStateSteady;

  return (
    <div className={styles.todayStateMetric}>
      <div className={styles.todayStateMetricHeader}>
        <span className={`${styles.todayStateMetricIcon} ${toneClassName}`} aria-hidden="true">
          {icon}
        </span>
        <div className={styles.todayStateMetricCopy}>
          <span className={styles.todayStateMetricLabel}>{label}</span>
          <span className={styles.todayStateMetricValue}>{value}</span>
        </div>
      </div>
      <div className={styles.todayStateBarTrack} aria-hidden="true">
        <span
          className={`${styles.todayStateBarFill} ${toneClassName}`}
          style={
            {
              "--today-state-fill": `${percent}%`,
            } as CSSProperties
          }
        />
      </div>
    </div>
  );
}

function CheckinSliderQuestion({
  title,
  options,
  value,
  onChange,
  helperText,
  className,
}: {
  title: string;
  options: CheckinOption[];
  value: number | null;
  onChange: (nextValue: number) => void;
  helperText?: string;
  className?: string;
}) {
  const isAnswered = value !== null;
  const optionIndex = value === null ? -1 : options.findIndex((option) => option.value === value);
  const fallbackIndex = Math.max(0, Math.floor((options.length - 1) / 2));
  const normalizedIndex = optionIndex >= 0 ? optionIndex : fallbackIndex;
  const fillPercent = `${(normalizedIndex / Math.max(1, options.length - 1)) * 100}%`;
  const activeLabel = value === null ? "Falta elegir" : options[normalizedIndex]?.label ?? "";

  return (
    <section
      className={`${styles.checkinQuestionBlock} ${
        isAnswered ? styles.checkinQuestionAnswered : styles.checkinQuestionPending
      } ${className ?? ""}`}
    >
      <div className={styles.checkinSliderHeader}>
        <div>
          <p className={styles.checkinQuestionTitle}>{title}</p>
          {helperText ? <p className={styles.checkinQuestionHelper}>{helperText}</p> : null}
        </div>
        <span
          className={`${styles.checkinSliderValue} ${
            isAnswered ? styles.checkinSliderValueAnswered : styles.checkinSliderValuePending
          }`}
        >
          {activeLabel}
        </span>
      </div>
      <div
        className={styles.checkinSliderWrap}
        style={
          {
            "--checkin-slider-fill": fillPercent,
          } as CSSProperties
        }
      >
        <input
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={normalizedIndex}
          onChange={(event) => {
            const nextIndex = Number(event.target.value);
            const nextOption = options[nextIndex];
            if (nextOption) {
              onChange(nextOption.value);
            }
          }}
          className={styles.checkinSlider}
          aria-label={title}
        />
      </div>
      <div className={styles.checkinSliderLabels}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`${styles.checkinSliderLabelButton} ${
              value === option.value ? styles.checkinSliderLabelButtonActive : ""
            }`}
            aria-pressed={value === option.value}
          >
            <span className={styles.checkinSliderLabelText}>{option.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function getAdvisorCardVariantClass(variant: SelectorCardVariant) {
  if (variant === "structured") return styles.advisorCardStructured;
  if (variant === "direct") return styles.advisorCardDirect;
  return styles.advisorCardCalm;
}

export function MvpEntryFlow() {
  const {
    displayName,
    sidebarConversation,
    activeConversation,
    activeConversationMessages,
    activeConversationMessagesLoading,
    openAdvisorConversation,
  } = useMvpShell();
  const [view, setView] = useState<FlowView>("entry");
  const [selectorIntent, setSelectorIntent] = useState<SelectorIntent | null>(null);
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>("laura");
  const [rememberAdvisor, setRememberAdvisor] = useState(false);
  const [preferredAdvisorId, setPreferredAdvisorId] = useState<string | null>(null);
  const [wizardKey, setWizardKey] = useState(0);
  const [resumeState, setResumeState] = useState<ConversationResumeState | null>(null);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  const [, setCheckinDismissedForVisit] = useState(false);
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [todayCheckin, setTodayCheckin] = useState<EmotionalCheckinSummary | null>(null);
  const [draftMoodLevel, setDraftMoodLevel] = useState<number | null>(null);
  const [draftConfidenceLevel, setDraftConfidenceLevel] = useState<number | null>(null);
  const [draftRecentContact, setDraftRecentContact] = useState<boolean | null>(null);
  const [draftRelationshipLevel, setDraftRelationshipLevel] = useState<number | null>(null);
  const [draftChildrenInteractionLevel, setDraftChildrenInteractionLevel] = useState<number | null>(null);

  function syncCheckinDrafts(checkin: EmotionalCheckinSummary | null) {
    setDraftMoodLevel(checkin?.mood_level ?? null);
    setDraftConfidenceLevel(checkin?.confidence_level ?? null);
    setDraftRecentContact(checkin?.recent_contact ?? null);
    setDraftRelationshipLevel(checkin?.vinculo_expareja ?? null);
    setDraftChildrenInteractionLevel(checkin?.interaccion_hijos ?? null);
  }

  useEffect(() => {
    const storedAdvisorId = readStoredAdvisorId();
    if (!storedAdvisorId) return;
    setSelectedAdvisorId(storedAdvisorId);
    setRememberAdvisor(true);
    setPreferredAdvisorId(storedAdvisorId);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadTodayCheckin() {
      try {
        const response = await getEmotionalCheckinToday();
        if (!mounted) return;
        const existingCheckin = response.today_checkin ?? null;
        setTodayCheckin(existingCheckin);
        syncCheckinDrafts(existingCheckin);
        setCheckinModalOpen(true);
      } catch {
        if (!mounted) return;
        syncCheckinDrafts(null);
        setCheckinModalOpen(true);
      }
    }
    void loadTodayCheckin();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function handleNewConversation() {
      setSelectorIntent(null);
      setHistoryPanelOpen(false);
      setResumeState(null);
      setPreferredAdvisorId(null);
      setView("entry");
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(WIZARD_VIEW_STORAGE_KEY);
      }
    }

    window.addEventListener("mvp:new-conversation", handleNewConversation);
    return () => {
      window.removeEventListener("mvp:new-conversation", handleNewConversation);
    };
  }, []);

  useEffect(() => {
    function handleConversationSelected() {
      setSelectorIntent(null);
      setHistoryPanelOpen(false);
      setResumeState(null);
      setPreferredAdvisorId(null);
      setView("entry");
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(WIZARD_VIEW_STORAGE_KEY);
      }
    }

    window.addEventListener("mvp:conversation-selected", handleConversationSelected);
    return () => {
      window.removeEventListener("mvp:conversation-selected", handleConversationSelected);
    };
  }, []);

  useEffect(() => {
    function handleHistoryCleared() {
      setTodayCheckin(null);
      syncCheckinDrafts(null);
      setCheckinError(null);
    }

    window.addEventListener("mvp:history-cleared", handleHistoryCleared);
    return () => {
      window.removeEventListener("mvp:history-cleared", handleHistoryCleared);
    };
  }, []);

  const greeting = useMemo(
    () => `${getGreetingLabel()}, ${getFirstName(displayName)}`.toLocaleUpperCase("es-UY"),
    [displayName],
  );

  const lastSessionMeta = useMemo(
    () => (sidebarConversation ? formatLastSession(sidebarConversation.startedAt) : null),
    [sidebarConversation],
  );

  const selectedAdvisor =
    ADVISOR_PROFILES.find((advisor) => advisor.id === selectedAdvisorId) ?? ADVISOR_PROFILES[0];

  const checkinSummaryLine = useMemo(() => {
    if (!todayCheckin) return null;
    const moodLabel = getMoodSummaryLabel(todayCheckin.mood_level);
    const confidenceLabel = getConfidenceSummaryLabel(todayCheckin.confidence_level);
    if (!moodLabel || !confidenceLabel) return null;
    return `Hoy: ánimo ${moodLabel.toLowerCase()} · confianza ${confidenceLabel.toLowerCase()}`;
  }, [todayCheckin]);

  const sessionTitleLabel =
    sidebarConversation?.title.trim() &&
    sidebarConversation.title.trim().toLowerCase() !== "nueva conversacion"
      ? sidebarConversation.title
      : "Borrador reciente";

  const activeConversationSummary = useMemo(() => {
    if (!activeConversation || activeConversationMessages.length === 0) return null;
    const latestMessage = activeConversationMessages[activeConversationMessages.length - 1] ?? null;
    if (!latestMessage) return null;
    return {
      count: activeConversationMessages.length,
      lastTypeLabel: getMessageTypeLabel(latestMessage.message_type),
      preview: getMessagePreview(latestMessage.content),
    };
  }, [activeConversation, activeConversationMessages]);

  const activeConversationResume = useMemo(
    () => (activeConversation ? buildResumeCta(activeConversationMessages) : null),
    [activeConversation, activeConversationMessages],
  );

  const activeConversationHistory = useMemo(
    () => buildHistoryEntries(activeConversationMessages),
    [activeConversationMessages],
  );

  const canSubmitCheckin =
    draftMoodLevel !== null &&
    draftConfidenceLevel !== null &&
    draftRecentContact !== null &&
    draftRelationshipLevel !== null &&
    !checkinSubmitting;

  const shouldShowChildrenInteractionQuestion =
    draftRelationshipLevel === 1 || draftRelationshipLevel === 2;

  useEffect(() => {
    if (!shouldShowChildrenInteractionQuestion && draftChildrenInteractionLevel !== null) {
      setDraftChildrenInteractionLevel(null);
    }
  }, [draftChildrenInteractionLevel, shouldShowChildrenInteractionQuestion]);

  useEffect(() => {
    setHistoryPanelOpen(false);
  }, [activeConversation?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (view === "wizard") {
      window.sessionStorage.setItem(WIZARD_VIEW_STORAGE_KEY, "wizard");
      return;
    }
    window.sessionStorage.removeItem(WIZARD_VIEW_STORAGE_KEY);
  }, [view]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (view !== "entry" || selectorIntent || activeConversationMessagesLoading) return;
    if (window.sessionStorage.getItem(WIZARD_VIEW_STORAGE_KEY) !== "wizard") return;
    if (!activeConversation || !activeConversationResume) {
      if (!activeConversationMessagesLoading) {
        window.sessionStorage.removeItem(WIZARD_VIEW_STORAGE_KEY);
      }
      return;
    }
    enterWizard(activeConversation.advisorId ?? null, {
      resumeState: activeConversationResume,
    });
  }, [
    activeConversation,
    activeConversationMessagesLoading,
    activeConversationResume,
    selectorIntent,
    view,
  ]);

  function openSelector(intent: SelectorIntent) {
    setResumeState(null);
    const storedAdvisorId = readStoredAdvisorId();
    if (storedAdvisorId) {
      setSelectedAdvisorId(storedAdvisorId);
      setRememberAdvisor(true);
    } else {
      setRememberAdvisor(false);
    }
    setSelectorIntent(intent);
  }

  function persistAdvisorPreference() {
    if (typeof window === "undefined") return;
    if (rememberAdvisor) {
      window.localStorage.setItem(DEFAULT_ADVISOR_STORAGE_KEY, selectedAdvisor.id);
      return;
    }
    window.localStorage.removeItem(DEFAULT_ADVISOR_STORAGE_KEY);
  }

  function enterWizard(
    nextPreferredAdvisorId: string | null,
    options?: { resumeState?: ConversationResumeState | null },
  ) {
    setPreferredAdvisorId(nextPreferredAdvisorId);
    setResumeState(options?.resumeState ?? null);
    setWizardKey((current) => current + 1);
    setView("wizard");
  }

  function handleAdvisorCardClick(advisorId: string) {
    const advisor = ADVISOR_PROFILES.find((item) => item.id === advisorId) ?? ADVISOR_PROFILES[0];
    if (selectorIntent === "vent") {
      setSelectorIntent(null);
      openAdvisorConversation(advisor.id);
      return;
    }
    setSelectedAdvisorId(advisor.id);
  }

  function handleConfirmAdvisor() {
    persistAdvisorPreference();
    setSelectorIntent(null);
    enterWizard(selectedAdvisor.id);
  }

  function handleAnalyzeConversation() {
    enterWizard(null);
  }

  function handleReturnToEntry() {
    setResumeState(null);
    setPreferredAdvisorId(null);
    setSelectorIntent(null);
    setView("entry");
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(WIZARD_VIEW_STORAGE_KEY);
    }
  }

  function handleResumeConversation() {
    if (!activeConversationResume) return;
    enterWizard(activeConversation?.advisorId ?? null, {
      resumeState: activeConversationResume,
    });
  }

  function handleOpenCheckinEditor() {
    syncCheckinDrafts(todayCheckin);
    setCheckinError(null);
    setCheckinDismissedForVisit(false);
    setCheckinModalOpen(true);
  }

  function handleOpenHistoryPanel() {
    if (activeConversationHistory.length === 0) return;
    setHistoryPanelOpen(true);
  }

  async function handleSaveDailyCheckin() {
    if (!canSubmitCheckin) return;
    setCheckinSubmitting(true);
    setCheckinError(null);
    try {
      const created = await postEmotionalCheckin({
        mood_level: draftMoodLevel,
        confidence_level: draftConfidenceLevel,
        recent_contact: draftRecentContact,
        vinculo_expareja: draftRelationshipLevel,
        interaccion_hijos: shouldShowChildrenInteractionQuestion ? draftChildrenInteractionLevel : null,
      });
      setTodayCheckin(created);
      syncCheckinDrafts(created);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("mvp:memory-updated"));
      }
      setCheckinModalOpen(false);
    } catch (error) {
      setCheckinError(toUiErrorMessage(error, "No pudimos guardar tu check-in por ahora."));
    } finally {
      setCheckinSubmitting(false);
    }
  }

  function handleSkipCheckinForVisit() {
    setCheckinDismissedForVisit(true);
    setCheckinModalOpen(false);
    setCheckinError(null);
  }

  return (
    <>
      {view === "entry" ? (
        <div className={`${styles.viewport} ${styles.entryViewport}`}>
          <div className={styles.entryShell}>
            <section className={styles.entryPanel}>
              <div className={styles.entryBody}>
                <div>
                  <p className={styles.eyebrow}>{greeting}</p>
                  <h1 className={styles.headline}>¿Cómo quieres avanzar hoy?</h1>
                  <p className={styles.subcopy}>
                    Puedes descargar, analizar una conversación o preparar tu próximo mensaje.
                  </p>
                </div>

                {checkinSummaryLine || (sidebarConversation && lastSessionMeta) || activeConversationSummary ? (
                  <div className={styles.contextSummaryGrid}>
                    {checkinSummaryLine ? (
                      <div className={styles.daySummaryCard}>
                        <span className={styles.daySummaryDot} aria-hidden="true" />
                        <div className={styles.contextSummaryTextBlock}>
                          <div className={styles.summaryCardHeaderRow}>
                            <p className={styles.contextSummaryLabel}>Resumen de hoy</p>
                            <button
                              type="button"
                              className={styles.summaryInlineButton}
                              onClick={handleOpenCheckinEditor}
                            >
                              Editar
                            </button>
                          </div>
                          <p className={styles.daySummaryText}>{checkinSummaryLine}</p>
                        </div>
                      </div>
                    ) : null}

                    {sidebarConversation && lastSessionMeta ? (
                      <div className={styles.sessionCard}>
                        <span className={styles.sessionDot} aria-hidden="true" />
                        <div className={styles.contextSummaryTextBlock}>
                          <p className={styles.contextSummaryLabel}>Última sesión</p>
                          <p className={styles.sessionText}>
                            {sessionTitleLabel} · {lastSessionMeta}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {activeConversation ? (
                      <div className={styles.historySummaryCard}>
                        <span className={styles.historySummaryDot} aria-hidden="true" />
                        <div className={styles.contextSummaryTextBlock}>
                          <p className={styles.contextSummaryLabel}>Conversación seleccionada</p>
                          {activeConversationMessagesLoading ? (
                            <p className={styles.historySummaryText}>Cargando conversación...</p>
                          ) : activeConversationSummary ? (
                            <>
                              <p className={styles.historySummaryText}>
                                {getSavedItemsLabel(activeConversationSummary.count)} · {activeConversationSummary.lastTypeLabel}
                              </p>
                              <p className={styles.historySummaryPreview}>{activeConversationSummary.preview}</p>
                              {activeConversationResume ? (
                                <div className={styles.historySummaryActions}>
                                  <p className={styles.historySummaryHint}>{activeConversationResume.helperText}</p>
                                  {activeConversationResume.previewText ? (
                                    <p className={styles.historySummaryResumePreview}>
                                      {activeConversationResume.previewText}
                                    </p>
                                  ) : null}
                                  <div className={styles.historySummaryButtonRow}>
                                    <button
                                      type="button"
                                      className={styles.historySummaryButton}
                                      onClick={handleResumeConversation}
                                    >
                                      {activeConversationResume.ctaLabel}
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.historySummarySecondaryButton}
                                      onClick={handleOpenHistoryPanel}
                                    >
                                      Ver historial
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <p className={styles.historySummaryText}>Todavía no guardaste contenido en esta conversación.</p>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.actionsHeader}>
                  <p className={styles.actionsKicker}>Elige cómo quieres usar ExReply hoy</p>
                </div>

                <div className={styles.actions}>
                  <button type="button" className={styles.primaryAction} onClick={() => openSelector("vent")}>
                    <span className={styles.buttonIconBadge} aria-hidden="true">
                      <svg viewBox="0 0 20 20" className={styles.buttonIcon} fill="none">
                        <path
                          d="M4.75 5.75h10.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H9.8L6.2 16.6a.75.75 0 0 1-1.2-.6v-2.25H4.75a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5Z"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.55"
                        />
                      </svg>
                    </span>
                    <span className={styles.actionTextBlock}>
                      <span className={styles.actionTitle}>Solo quiero desahogarme</span>
                      <span className={styles.actionCopy}>{"Habl\u00e1 con un consejero sobre c\u00f3mo te sent\u00eds"}</span>
                    </span>
                  </button>
                  <button type="button" className={styles.secondaryAction} onClick={handleAnalyzeConversation}>
                    <span className={styles.buttonIconBadge} aria-hidden="true">
                      <svg viewBox="0 0 20 20" className={styles.buttonIcon} fill="none">
                        <path
                          d="M6 4.5h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 14 16.5H6A1.5 1.5 0 0 1 4.5 15V6A1.5 1.5 0 0 1 6 4.5Z"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.55"
                        />
                        <path
                          d="M7.5 8h5M7.5 10.75h5M7.5 13.5H11"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="1.55"
                        />
                      </svg>
                    </span>
                    <span className={styles.actionTextBlock}>
                      <span className={styles.actionTitle}>Tengo una conversación para analizar</span>
                      <span className={styles.actionCopy}>Revisar contexto, ver el análisis y decidir con más claridad.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.tertiaryAction}
                    onClick={() => openSelector("write_to_ex")}
                  >
                    <span className={styles.buttonIconBadge} aria-hidden="true">
                      <svg viewBox="0 0 20 20" className={styles.buttonIcon} fill="none">
                        <path
                          d="M4.75 15.25V17h1.75l7.5-7.5-1.75-1.75-7.5 7.5ZM13 6.25l1.3-1.3a1.06 1.06 0 0 1 1.5 0l.25.25a1.06 1.06 0 0 1 0 1.5l-1.3 1.3L13 6.25Z"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.55"
                        />
                      </svg>
                    </span>
                    <span className={styles.actionTextBlock}>
                      <span className={styles.actionTitle}>Quiero escribirle a mi ex</span>
                      <span className={styles.actionCopy}>Elegir consejero y después preparar mejor tu próximo mensaje.</span>
                    </span>
                  </button>
                </div>

                {todayCheckin || (sidebarConversation && lastSessionMeta) || activeConversationSummary ? (
                  <section className={styles.contextSummarySection}>
                    <div className={styles.contextSummarySectionHeader}>
                      <div>
                        <p className={styles.contextSummarySectionEyebrow}>Tu proceso hoy</p>
                        <p className={styles.contextSummarySectionTitle}>Un vistazo simple para volver a ubicarse.</p>
                      </div>
                      {todayCheckin ? (
                        <button type="button" className={styles.summaryInlineButton} onClick={handleOpenCheckinEditor}>
                          Ajustar check-in
                        </button>
                      ) : null}
                    </div>

                    <div className={styles.contextSummaryCards}>
                      {todayCheckin ? (
                        <section className={`${styles.daySummaryCard} ${styles.todayStateCard}`}>
                          <div className={styles.summaryCardHeaderRow}>
                            <div>
                              <p className={styles.contextSummaryLabel}>Resumen de hoy</p>
                              <p className={styles.todayStateTitle}>Tu estado de hoy</p>
                            </div>
                            <span className={styles.todayStateChip}>{checkinSummaryLine ?? "Check-in listo"}</span>
                          </div>
                          <div className={styles.todayStateMetrics}>
                            <TodayStateMetric
                              label="Animo"
                              value={getMoodSummaryLabel(todayCheckin.mood_level) ?? "Sin registrar"}
                              percent={getCheckinPercent(todayCheckin.mood_level)}
                              tone={getCheckinTone(todayCheckin.mood_level)}
                              icon={
                                <svg viewBox="0 0 20 20" className={styles.todayStateMetricSvg} fill="none">
                                  <path
                                    d="M10 16.25s-4.75-2.95-4.75-7.05A2.7 2.7 0 0 1 8 6.5c.84 0 1.63.39 2 .99.37-.6 1.16-.99 2-.99a2.7 2.7 0 0 1 2.75 2.7c0 4.1-4.75 7.05-4.75 7.05Z"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              }
                            />
                            <TodayStateMetric
                              label="Confianza"
                              value={getConfidenceSummaryLabel(todayCheckin.confidence_level) ?? "Sin registrar"}
                              percent={getCheckinPercent(todayCheckin.confidence_level)}
                              tone={getCheckinTone(todayCheckin.confidence_level)}
                              icon={
                                <svg viewBox="0 0 20 20" className={styles.todayStateMetricSvg} fill="none">
                                  <path
                                    d="M10 3.75 14.75 5.5v3.7c0 2.93-1.86 5.47-4.75 6.8-2.89-1.33-4.75-3.87-4.75-6.8V5.5L10 3.75Z"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              }
                            />
                          </div>
                          <div className={styles.todayStateFooter}>
                            <span className={styles.todayStateFooterLabel}>Contacto reciente</span>
                            <span
                              className={`${styles.todayStateContactChip} ${
                                todayCheckin.recent_contact ? styles.todayStateContactChipAlert : styles.todayStateContactChipCalm
                              }`}
                            >
                              {getRecentContactSummary(todayCheckin.recent_contact)}
                            </span>
                          </div>
                        </section>
                      ) : null}

                      <div className={styles.contextSummaryGrid}>
                        {sidebarConversation && lastSessionMeta ? (
                          <div className={styles.sessionCard}>
                            <span className={styles.sessionDot} aria-hidden="true" />
                            <div className={styles.contextSummaryTextBlock}>
                              <p className={styles.contextSummaryLabel}>Última sesión</p>
                              <p className={styles.sessionText}>
                                {sessionTitleLabel} · {lastSessionMeta}
                              </p>
                            </div>
                          </div>
                        ) : null}

                        {activeConversation ? (
                          <div className={styles.historySummaryCard}>
                            <span className={styles.historySummaryDot} aria-hidden="true" />
                            <div className={styles.contextSummaryTextBlock}>
                              <p className={styles.contextSummaryLabel}>Conversación seleccionada</p>
                              {activeConversationMessagesLoading ? (
                                <p className={styles.historySummaryText}>Cargando conversación...</p>
                              ) : activeConversationSummary ? (
                                <>
                                  <p className={styles.historySummaryText}>
                                    {getSavedItemsLabel(activeConversationSummary.count)} · {activeConversationSummary.lastTypeLabel}
                                  </p>
                                  <p className={styles.historySummaryPreview}>{activeConversationSummary.preview}</p>
                                  {activeConversationResume ? (
                                    <div className={styles.historySummaryActions}>
                                      <p className={styles.historySummaryHint}>{activeConversationResume.helperText}</p>
                                      {activeConversationResume.previewText ? (
                                        <p className={styles.historySummaryResumePreview}>
                                          {activeConversationResume.previewText}
                                        </p>
                                      ) : null}
                                      <div className={styles.historySummaryButtonRow}>
                                        <button
                                          type="button"
                                          className={styles.historySummaryButton}
                                          onClick={handleResumeConversation}
                                        >
                                          {activeConversationResume.ctaLabel}
                                        </button>
                                        <button
                                          type="button"
                                          className={styles.historySummarySecondaryButton}
                                          onClick={handleOpenHistoryPanel}
                                        >
                                          Ver historial
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <p className={styles.historySummaryText}>Todavía no guardaste contenido en esta conversación.</p>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </section>
                ) : null}

                <p className={styles.disclaimer}>
                  Guardamos el contexto mínimo para que puedas retomar tu proceso. La IA puede equivocarse.
                  <br />
                  No reemplaza apoyo <a href="#" className={styles.disclaimerLink}>psicológico</a>, legal ni atención de emergencia.
                </p>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className={styles.wizardViewport}>
          {preferredAdvisorId ? (
            <section className={styles.intentNotice}>
              <p className={styles.intentLabel}>Escritura guiada</p>
              <p className={styles.intentTitle}>
                Entrarás al flujo actual de análisis y después podrás afinar con{" "}
                {ADVISOR_PROFILES.find((advisor) => advisor.id === preferredAdvisorId)?.name ?? "tu consejero"}.
              </p>
              <p className={styles.intentText}>
                No creamos un flujo nuevo: reutilizamos el wizard actual y dejamos marcado tu consejero
                elegido para la parte de respuesta.
              </p>
            </section>
          ) : null}

          <div className={styles.wizardPanelWrap}>
            <WizardScaffold
              key={wizardKey}
              preferredAdvisorId={preferredAdvisorId}
              resumeState={resumeState}
              onExitToEntry={handleReturnToEntry}
            />
          </div>
        </div>
      )}

      {checkinModalOpen && view === "entry" ? (
        <div className={styles.checkinBackdrop} role="presentation">
          <section
            className={styles.checkinModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-checkin-title"
          >
            <button
              type="button"
              className={styles.checkinClose}
              aria-label="Omitir por hoy"
              onClick={handleSkipCheckinForVisit}
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

            <div className={styles.checkinHeader}>
              <p className={styles.checkinEyebrow}>Check-in diario</p>
              <h2 id="daily-checkin-title" className={styles.checkinTitle}>
                Antes de empezar, ¿cómo estás hoy?
              </h2>
              <p className={styles.checkinSubtitle}>
                Esto nos ayuda a acompañarte mejor y a sugerirte cuándo conviene responder y cuándo no.
              </p>
            </div>

            <div className={styles.checkinBody}>
              <CheckinSliderQuestion
                title="¿Cómo estás emocionalmente hoy?"
                options={DAILY_MOOD_OPTIONS}
                value={draftMoodLevel}
                onChange={setDraftMoodLevel}
                className={styles.checkinQuestionSpanTwo}
              />

              <CheckinSliderQuestion
                title="¿Cómo sientes tu confianza hoy?"
                options={DAILY_CONFIDENCE_OPTIONS}
                value={draftConfidenceLevel}
                onChange={setDraftConfidenceLevel}
                className={styles.checkinQuestionSpanTwo}
              />
              <CheckinSliderQuestion
                title="Como esta el vinculo con tu expareja actualmente?"
                options={EX_RELATIONSHIP_OPTIONS}
                value={draftRelationshipLevel}
                onChange={setDraftRelationshipLevel}
                className={styles.checkinQuestionSpanTwo}
              />

              <section
                className={`${styles.checkinQuestionBlock} ${
                  draftRecentContact !== null ? styles.checkinQuestionAnswered : styles.checkinQuestionPending
                } ${
                  shouldShowChildrenInteractionQuestion
                    ? styles.checkinQuestionSpanTwo
                    : styles.checkinQuestionSpanFull
                }`}
              >
                <p className={styles.checkinQuestionTitle}>
                  ¿Tuviste contacto con tu ex en las últimas 12 horas?
                </p>
                <div className={styles.checkinQuestionStatusRow}>
                  <span
                    className={`${styles.checkinSliderValue} ${
                      draftRecentContact !== null
                        ? styles.checkinSliderValueAnswered
                        : styles.checkinSliderValuePending
                    }`}
                  >
                    {draftRecentContact === null ? "Falta elegir" : draftRecentContact ? "Si" : "No"}
                  </span>
                </div>
                <div className={styles.binaryOptionRow}>
                  <button
                    type="button"
                    className={`${styles.binaryOptionButton} ${draftRecentContact === true ? styles.binaryOptionButtonActive : ""}`}
                    onClick={() => setDraftRecentContact(true)}
                    aria-pressed={draftRecentContact === true}
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    className={`${styles.binaryOptionButton} ${draftRecentContact === false ? styles.binaryOptionButtonActive : ""}`}
                    onClick={() => setDraftRecentContact(false)}
                    aria-pressed={draftRecentContact === false}
                  >
                    No
                  </button>
                </div>
              </section>
              {shouldShowChildrenInteractionQuestion ? (
                <CheckinSliderQuestion
                  title="Si esto aplica en tu caso, como sentiste la interaccion reciente alrededor de tus hijos?"
                  helperText="Opcional. Puedes dejarlo sin responder si hoy no aplica para ti."
                  options={CHILDREN_INTERACTION_OPTIONS}
                  value={draftChildrenInteractionLevel}
                  onChange={setDraftChildrenInteractionLevel}
                  className={styles.checkinQuestionSpanFour}
                />
              ) : null}
            </div>

            {checkinError ? <p className={styles.checkinError}>{checkinError}</p> : null}

            <div className={styles.checkinActions}>
              <button type="button" className={styles.checkinSecondary} onClick={handleSkipCheckinForVisit}>
                Omitir por hoy
              </button>
              <button
                type="button"
                className={styles.checkinPrimary}
                onClick={() => void handleSaveDailyCheckin()}
                disabled={!canSubmitCheckin}
              >
                {checkinSubmitting ? "Guardando..." : "Guardar y continuar"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {historyPanelOpen && view === "entry" ? (
        <div className={styles.historyDrawerBackdrop} role="presentation" onClick={() => setHistoryPanelOpen(false)}>
          <aside
            className={styles.historyDrawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="conversation-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.historyDrawerHeader}>
              <div>
                <p className={styles.historyDrawerEyebrow}>Historial</p>
                <h2 id="conversation-history-title" className={styles.historyDrawerTitle}>
                  {activeConversation?.title?.trim() &&
                  activeConversation.title.trim().toLowerCase() !== "nueva conversacion"
                    ? activeConversation.title
                    : "Conversación seleccionada"}
                </h2>
              </div>
              <button
                type="button"
                className={styles.historyDrawerClose}
                aria-label="Cerrar historial"
                onClick={() => setHistoryPanelOpen(false)}
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
            </div>

            {activeConversationMessagesLoading ? (
              <p className={styles.historyDrawerEmpty}>Cargando historial...</p>
            ) : activeConversationHistory.length > 0 ? (
              <div className={styles.historyTimeline}>
                {activeConversationHistory.map((entry) => (
                  <article key={entry.id} className={styles.historyTimelineItem}>
                    <div className={styles.historyTimelineMeta}>
                      <p className={styles.historyTimelineLabel}>{entry.label}</p>
                      <p className={styles.historyTimelineTimestamp}>{entry.timestamp}</p>
                    </div>
                    <p className={styles.historyTimelineContent}>{entry.content}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.historyDrawerEmpty}>Todavía no hay historial útil para mostrar.</p>
            )}
          </aside>
        </div>
      ) : null}

      {selectorIntent ? (
        <div
          className={styles.sheetBackdrop}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectorIntent(null);
            }
          }}
        >
          <section
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="advisor-selector-title"
          >
            <div className={styles.sheetHeader}>
              <div>
                <h2 id="advisor-selector-title" className={styles.sheetTitle}>
                  {selectorIntent === "vent"
                    ? "¿Con quién quieres hablar ahora?"
                    : "¿Con quién quieres escribir?"}
                </h2>
                <p className={styles.sheetSubtitle}>
                  {selectorIntent === "vent"
                    ? "Elige una perspectiva y entra directo al espacio de conversación."
                    : "Elige el consejero que quieres priorizar cuando pases al flujo actual de respuesta."}
                </p>
              </div>
              <button
                type="button"
                className={styles.sheetClose}
                aria-label="Cerrar selector de consejeros"
                onClick={() => setSelectorIntent(null)}
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
            </div>

            <div className={styles.advisorList}>
              {ADVISOR_PROFILES.map((advisor) => {
                const isActive = advisor.id === selectedAdvisor.id;
                const isVentSelector = selectorIntent === "vent";
                return (
                  <button
                    key={advisor.id}
                    type="button"
                    className={`${styles.advisorCard} ${getAdvisorCardVariantClass(
                      ADVISOR_CARD_VARIANT[advisor.id] ?? "calm",
                    )} ${isActive && !isVentSelector ? styles.advisorCardActive : ""}`}
                    onClick={() => handleAdvisorCardClick(advisor.id)}
                  >
                    <div className={styles.advisorAvatarWrap}>
                      <Image
                        src={advisor.avatar128}
                        alt={advisor.name}
                        width={88}
                        height={88}
                        className={styles.advisorAvatarImage}
                      />
                    </div>
                    <div className={styles.advisorCardBody}>
                      <div className={styles.advisorCardHeader}>
                        <span className={styles.advisorName}>{advisor.name}</span>
                        <span className={styles.advisorRole}>{advisor.role}</span>
                      </div>
                      <p className={styles.advisorCopy}>{ADVISOR_MICROCOPY[advisor.id]}</p>
                      <p className={styles.advisorStyleLabel}>Estilo: {ADVISOR_STYLE_LABEL[advisor.id]}</p>
                    </div>
                    {isActive && !isVentSelector ? (
                      <span className={styles.advisorSelectedMark}>Elegido</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selectorIntent === "write_to_ex" ? (
              <>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={rememberAdvisor}
                    onChange={(event) => setRememberAdvisor(event.target.checked)}
                    className={styles.checkbox}
                  />
                  <span>Usar este consejero por defecto</span>
                </label>

                <div className={styles.sheetActions}>
                  <button type="button" className={styles.sheetPrimary} onClick={handleConfirmAdvisor}>
                    Continuar con este consejero
                  </button>
                  <button type="button" className={styles.sheetSecondary} onClick={() => setSelectorIntent(null)}>
                    Volver
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
