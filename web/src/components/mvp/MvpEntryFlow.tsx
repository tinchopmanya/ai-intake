"use client";

import type { ChangeEvent, ClipboardEvent, CSSProperties } from "react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/mvp/MvpEntryFlow.module.css";
import { useMvpShell } from "@/components/mvp/MvpShellContext";
import { WizardScaffold, type ConversationResumeState } from "@/components/mvp/WizardScaffold";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { authFetch, hasStoredSession } from "@/lib/auth/client";
import { getEmotionalCheckinToday, postEmotionalCheckin } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import type { EmotionalCheckinSummary, MessageSummary, OcrCapabilitiesResponse, OcrExtractResponse } from "@/lib/api/types";
import { API_URL } from "@/lib/config";
import {
  getMicrophoneStatusMessage,
  getSpeechToTextErrorMessage,
  useSpeechToText,
} from "@/hooks/useSpeechToText";

type FlowView = "entry" | "wizard";
type SelectorIntent = "vent" | "write_to_ex";
type SelectorCardVariant = "calm" | "structured" | "direct";
type HomeInputMode = "write" | "capture" | "voice";
type CheckinFlow = "edit" | "post_session";
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
const OCR_EXTRACT_URL = `${API_URL}/v1/ocr/extract`;
const OCR_CAPABILITIES_URL = `${API_URL}/v1/ocr/capabilities`;
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

const SESSION_OUTCOME_OPTIONS: CheckinOption[] = [
  { value: 1, label: "Mas tenso/a" },
  { value: 2, label: "Algo cargado/a" },
  { value: 3, label: "Igual que antes" },
  { value: 4, label: "Mas claro/a" },
  { value: 5, label: "Mas tranquilo/a" },
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

const OCR_ERROR_MESSAGES: Record<string, string> = {
  missing_image_file: "Selecciona una imagen para continuar.",
  unsupported_image_mime_type: "Formato no compatible. Usa PNG, JPG o WebP.",
  empty_file: "La imagen seleccionada está vacía.",
  file_too_large: "La imagen es demasiado grande.",
  python_multipart_not_installed: "OCR no disponible en este entorno.",
  ocr_no_text_detected: "No detectamos texto legible. Prueba otra captura más nítida.",
  invalid_image_file: "No pudimos leer la imagen. Prueba con otro archivo.",
  pillow_not_installed: "OCR no disponible por configuración del servidor.",
  pytesseract_not_installed: "OCR no disponible por configuración del servidor.",
  tesseract_not_installed: "OCR no disponible: falta Tesseract en el servidor.",
  tesseract_not_available: "OCR no disponible en este servidor.",
  tesseract_binary_not_found: "OCR no disponible: Tesseract no fue encontrado.",
  tesseract_language_not_available: "OCR no disponible para el idioma configurado.",
  tesseract_execution_failed: "No se pudo procesar la imagen con OCR.",
  google_vision_dependency_missing: "OCR no disponible por configuración del servidor.",
  google_vision_not_configured: "OCR no disponible: Google Vision no está configurado.",
  google_vision_request_failed: "No se pudo procesar la imagen en este momento.",
  ocr_unavailable: "OCR no está disponible ahora. Intenta de nuevo más tarde.",
  ocr_internal_error: "Error interno al leer la imagen.",
  invalid_or_expired_session: "Tu sesión expiró. Inicia sesión nuevamente.",
  missing_bearer_token: "Necesitas iniciar sesión para usar OCR.",
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
  const [entryInputMode, setEntryInputMode] = useState<HomeInputMode>("write");
  const [entryMessageText, setEntryMessageText] = useState("");
  const [entryOcrLoading, setEntryOcrLoading] = useState(false);
  const [entryOcrError, setEntryOcrError] = useState<string | null>(null);
  const [entryOcrInfo, setEntryOcrInfo] = useState<OcrExtractResponse | null>(null);
  const [entryOcrStatus, setEntryOcrStatus] = useState<string | null>(null);
  const [entryOcrCapabilities, setEntryOcrCapabilities] = useState<OcrCapabilitiesResponse | null>(null);
  const [entryOcrCapabilitiesLoading, setEntryOcrCapabilitiesLoading] = useState(true);
  const [wizardInitialInput, setWizardInitialInput] = useState<string | null>(null);
  const [wizardInitialMode, setWizardInitialMode] = useState<HomeInputMode>("write");
  const [wizardAutoSubmit, setWizardAutoSubmit] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  const [checkinFlow, setCheckinFlow] = useState<CheckinFlow>("post_session");
  const [, setCheckinDismissedForVisit] = useState(false);
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [todayCheckin, setTodayCheckin] = useState<EmotionalCheckinSummary | null>(null);
  const [draftMoodLevel, setDraftMoodLevel] = useState<number | null>(null);
  const [draftConfidenceLevel, setDraftConfidenceLevel] = useState<number | null>(null);
  const [draftRecentContact, setDraftRecentContact] = useState<boolean | null>(null);
  const [draftRelationshipLevel, setDraftRelationshipLevel] = useState<number | null>(null);
  const [draftChildrenInteractionLevel, setDraftChildrenInteractionLevel] = useState<number | null>(null);
  const [draftSessionOutcomeLevel, setDraftSessionOutcomeLevel] = useState<number | null>(4);
  const entryFileInputRef = useRef<HTMLInputElement | null>(null);
  const entryVoice = useSpeechToText({
    lang: "es-ES",
    continuous: false,
    interimResults: false,
  });
  const entryVoiceTranscript = entryVoice.transcript;
  const resetEntryVoiceTranscript = entryVoice.resetTranscript;
  const entryVoiceStatusMessage = getMicrophoneStatusMessage(
    entryVoice.microphoneStatus,
    entryVoice.speechSupported,
  );

  function syncCheckinDrafts(checkin: EmotionalCheckinSummary | null) {
    setDraftMoodLevel(checkin?.mood_level ?? null);
    setDraftConfidenceLevel(checkin?.confidence_level ?? null);
    setDraftRecentContact(checkin?.recent_contact ?? null);
    setDraftRelationshipLevel(checkin?.vinculo_expareja ?? null);
    setDraftChildrenInteractionLevel(checkin?.interaccion_hijos ?? null);
    setDraftSessionOutcomeLevel(4);
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
      } catch {
        if (!mounted) return;
        syncCheckinDrafts(null);
      }
    }
    void loadTodayCheckin();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadEntryOcrCapabilities() {
      setEntryOcrCapabilitiesLoading(true);
      try {
        const response = await authFetch(OCR_CAPABILITIES_URL, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as OcrCapabilitiesResponse;
        if (!mounted) return;
        setEntryOcrCapabilities(payload);
      } catch {
        if (!mounted) return;
        setEntryOcrCapabilities({
          available: false,
          selected_provider: "auto",
          providers_checked: [],
          reason_codes: ["ocr_unavailable"],
        });
      } finally {
        if (mounted) setEntryOcrCapabilitiesLoading(false);
      }
    }
    void loadEntryOcrCapabilities();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const transcript = entryVoiceTranscript.trim();
    if (!transcript) return;
    setEntryInputMode("voice");
    setEntryMessageText((previous) => (previous.trim() ? `${previous.trim()}\n${transcript}` : transcript));
    resetEntryVoiceTranscript();
  }, [entryVoiceTranscript, resetEntryVoiceTranscript]);

  useEffect(() => {
    function handleNewConversation() {
      setSelectorIntent(null);
      setHistoryPanelOpen(false);
      setResumeState(null);
      setPreferredAdvisorId(null);
      setView("entry");
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

  const selectedAdvisor =
    ADVISOR_PROFILES.find((advisor) => advisor.id === selectedAdvisorId) ?? ADVISOR_PROFILES[0];

  const checkinSummaryLine = useMemo(() => {
    if (!todayCheckin) return null;
    const moodLabel = getMoodSummaryLabel(todayCheckin.mood_level);
    const confidenceLabel = getConfidenceSummaryLabel(todayCheckin.confidence_level);
    if (!moodLabel || !confidenceLabel) return null;
    return `Ánimo ${moodLabel.toLowerCase()} · confianza ${confidenceLabel.toLowerCase()}`;
  }, [todayCheckin]);
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

  async function processEntryImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setEntryOcrError("Selecciona una imagen v?lida (PNG, JPG o WebP).");
      return;
    }
    if (!hasStoredSession()) {
      setEntryOcrError("Tu sesi?n no est? activa. Inicia sesi?n para usar esta funci?n.");
      return;
    }
    if (entryOcrCapabilitiesLoading || entryOcrCapabilities?.available === false) {
      setEntryOcrError("La carga por captura no est? disponible en este entorno.");
      return;
    }

    setEntryOcrLoading(true);
    setEntryOcrError(null);
    setEntryOcrInfo(null);
    setEntryOcrStatus("Procesando captura...");
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
        throw new Error(resolveOcrErrorMessage(errorPayload?.detail, errorPayload?.message));
      }
      const payload = (await response.json()) as OcrExtractResponse;
      setEntryMessageText(payload.extracted_text);
      setEntryOcrInfo(payload);
      setEntryOcrStatus("Texto extra?do y listo para revisar.");
    } catch (error) {
      setEntryOcrError(toUiErrorMessage(error, "No se pudo leer el texto de la imagen."));
      setEntryOcrStatus(null);
    } finally {
      setEntryOcrLoading(false);
    }
  }

  function handleEntryImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    void processEntryImageFile(file);
    event.target.value = "";
  }

  function handleEntryPaste(event: ClipboardEvent<HTMLElement>) {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    void processEntryImageFile(file);
  }

  function enterWizard(
    nextPreferredAdvisorId: string | null,
    options?: {
      resumeState?: ConversationResumeState | null;
      initialInput?: string | null;
      initialStepInputMode?: HomeInputMode;
      autoSubmit?: boolean;
    },
  ) {
    setPreferredAdvisorId(nextPreferredAdvisorId);
    setResumeState(options?.resumeState ?? null);
    setWizardInitialInput(options?.initialInput ?? null);
    setWizardInitialMode(options?.initialStepInputMode ?? "write");
    setWizardAutoSubmit(options?.autoSubmit ?? false);
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
    enterWizard(selectedAdvisor.id, {
      initialInput: entryMessageText.trim() || null,
      initialStepInputMode: "write",
      autoSubmit: Boolean(entryMessageText.trim()),
    });
  }

  function handleAnalyzeConversation() {
    const normalizedMessage = entryMessageText.trim();
    if (!normalizedMessage) return;
    enterWizard(null, {
      initialInput: normalizedMessage,
      initialStepInputMode: entryInputMode,
      autoSubmit: true,
    });
  }

  function handleReturnToEntry() {
    setResumeState(null);
    setPreferredAdvisorId(null);
    setSelectorIntent(null);
    setWizardInitialInput(null);
    setWizardAutoSubmit(false);
    setWizardInitialMode("write");
    setView("entry");
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
    setCheckinFlow("edit");
    setCheckinModalOpen(true);
  }

  function handleOpenPostSessionCheckin() {
    syncCheckinDrafts(todayCheckin);
    setCheckinError(null);
    setCheckinDismissedForVisit(false);
    setCheckinFlow("post_session");
    setCheckinModalOpen(true);
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
      if (checkinFlow === "post_session") {
        handleReturnToEntry();
      }
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
    if (checkinFlow === "post_session") {
      handleReturnToEntry();
    }
  }

  const canSubmitEntry = entryMessageText.trim().length > 0 && !entryOcrLoading;
  const entryPrimaryLabel =
    entryInputMode === "capture"
      ? "Analizar esta captura"
      : entryInputMode === "voice"
        ? "Analizar este dictado"
        : "Ver recomendación y advisors";

  return (
    <>
      {view === "entry" ? (
        <div className={`${styles.viewport} ${styles.entryViewport}`}>
          <div className={styles.entryShell}>
            <div className={styles.homeSceneFx} aria-hidden="true">
              <span className={styles.homeLighthouseSourceGlow} />
              <span className={`${styles.homeLighthouseBeam} ${styles.homeLighthouseBeamWhite}`} />
              <span className={`${styles.homeLighthouseBeam} ${styles.homeLighthouseBeamAmber}`} />
              <span className={styles.homeRiverLight} />
              <span className={styles.homeCompassCore} />
              <span className={styles.homeCompassSpark} />
            </div>
            <section className={styles.homePanel}>
              <div className={styles.homeHero}>
                <h1 className={styles.homeTitle}>¿Qué pasó con tu ex hoy?</h1>
              </div>

              <section className={styles.homeInputCard} onPaste={entryInputMode === "capture" ? handleEntryPaste : undefined}>
                <div className={styles.homeInputTabs}>
                  <button
                    type="button"
                    className={`${styles.homeInputTab} ${entryInputMode === "write" ? styles.homeInputTabActive : ""}`}
                    onClick={() => setEntryInputMode("write")}
                  >
                    Escribir
                  </button>
                  <button
                    type="button"
                    className={`${styles.homeInputTab} ${entryInputMode === "capture" ? styles.homeInputTabActive : ""}`}
                    onClick={() => setEntryInputMode("capture")}
                  >
                    Captura
                  </button>
                  <button
                    type="button"
                    className={`${styles.homeInputTab} ${entryInputMode === "voice" ? styles.homeInputTabActive : ""}`}
                    onClick={() => setEntryInputMode("voice")}
                  >
                    Voz
                  </button>
                </div>

                <div className={styles.homeInputBody}>
                  {entryInputMode === "write" ? (
                    <textarea
                      value={entryMessageText}
                      onChange={(event) => setEntryMessageText(event.target.value)}
                      className={styles.homeTextarea}
                      placeholder='Pegá el mensaje o contá qué pasó. Ej: "Me mandó un audio diciendo que quiere cambiar el régimen de visitas..."'
                    />
                  ) : null}

                  {entryInputMode === "capture" ? (
                    <div className={styles.homeCapturePanel}>
                      <div className={styles.homeCaptureActions}>
                        <input
                          ref={entryFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className={styles.homeHiddenInput}
                          onChange={handleEntryImageSelection}
                        />
                        <button
                          type="button"
                          className={styles.homeCaptureButton}
                          onClick={() => entryFileInputRef.current?.click()}
                          disabled={entryOcrLoading || entryOcrCapabilities?.available === false || entryOcrCapabilitiesLoading}
                        >
                          Subir captura
                        </button>
                        <div className={styles.homeCaptureHintBlock}>
                          <p className={styles.homeAssistTitle}>Pegá o subí la imagen acá mismo</p>
                          <p className={styles.homeAssistCopy}>
                            Reutilizamos el OCR real del producto para extraer el texto sin sacar al usuario de la home.
                          </p>
                        </div>
                      </div>
                      <textarea
                        value={entryMessageText}
                        onChange={(event) => setEntryMessageText(event.target.value)}
                        className={styles.homeTextarea}
                        placeholder="Cuando leas una captura, el texto va a aparecer acá para que lo revises antes del análisis."
                      />
                      <div className={styles.homeStatusStack}>
                        {entryOcrCapabilities?.available === false ? (
                          <p className={styles.homeStatusWarning}>
                            OCR no disponible: {resolveOcrErrorMessage(entryOcrCapabilities.reason_codes[0])}
                          </p>
                        ) : null}
                        {entryOcrLoading ? <p className={styles.homeStatusInfo}>Procesando captura...</p> : null}
                        {entryOcrStatus ? <p className={styles.homeStatusInfo}>{entryOcrStatus}</p> : null}
                        {entryOcrInfo?.provider ? (
                          <p className={styles.homeStatusSubtle}>Proveedor detectado: {entryOcrInfo.provider}</p>
                        ) : null}
                        {entryOcrError ? <p className={styles.homeStatusError}>{entryOcrError}</p> : null}
                      </div>
                    </div>
                  ) : null}

                  {entryInputMode === "voice" ? (
                    <div className={styles.homeVoicePanel}>
                      <div className={styles.homeVoiceRow}>
                        <button
                          type="button"
                          className={`${styles.homeVoiceButton} ${entryVoice.listening ? styles.homeVoiceButtonActive : ""}`}
                          onClick={() => {
                            if (entryVoice.listening) {
                              entryVoice.stopListening();
                            } else {
                              entryVoice.startListening();
                            }
                          }}
                          disabled={entryVoice.microphoneStatus === "requesting"}
                          aria-label={entryVoice.listening ? "Detener dictado" : "Empezar dictado"}
                        >
                          {entryVoice.listening ? "Detener" : "Dictar"}
                        </button>
                        <div className={styles.homeCaptureHintBlock}>
                          <p className={styles.homeAssistTitle}>
                            {entryVoice.listening ? "Te estamos escuchando" : "Dictá desde acá mismo"}
                          </p>
                          <p className={styles.homeAssistCopy}>
                            {entryVoiceStatusMessage || "Tu voz se agrega al texto principal para revisar antes del análisis."}
                          </p>
                        </div>
                      </div>
                      <textarea
                        value={entryMessageText}
                        onChange={(event) => setEntryMessageText(event.target.value)}
                        className={styles.homeTextarea}
                        placeholder="Lo que dictes aparece acá para que lo ordenes antes de analizar."
                      />
                      {entryVoice.error ? (
                        <p className={styles.homeStatusWarning}>{getSpeechToTextErrorMessage(entryVoice.error)}</p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className={styles.homeInputFooter}>
                    <span className={styles.homeInputHint}>Tu conversación no se comparte con nadie.</span>
                    <button
                      type="button"
                      className={styles.homePrimaryButton}
                      onClick={handleAnalyzeConversation}
                      disabled={!canSubmitEntry}
                    >
                      {entryPrimaryLabel}
                    </button>
                  </div>
                </div>
              </section>

              <div className={styles.quickActions}>
                <button type="button" className={styles.quickActionCard} onClick={() => openSelector("vent")}>
                  <span className={styles.quickActionTitle}>Solo quiero desahogarme</span>
                  <span className={styles.quickActionCopy}>Entrá directo a hablar con un advisor sin analizar nada concreto.</span>
                </button>
                <button type="button" className={styles.quickActionCard} onClick={() => openSelector("write_to_ex")}>
                  <span className={styles.quickActionTitle}>Quiero escribirle a mi ex</span>
                  <span className={styles.quickActionCopy}>Elegí un advisor y seguí con el flujo real de redacción.</span>
                </button>
              </div>

              {(activeConversationSummary || todayCheckin) ? (
                <section className={styles.homeContextStrip}>
                  {todayCheckin ? (
                    <button type="button" className={styles.homeContextCard} onClick={handleOpenCheckinEditor}>
                      <span className={styles.homeContextLabel}>Estado de hoy</span>
                      <span className={styles.homeContextValue}>{checkinSummaryLine ?? "Check-in disponible"}</span>
                    </button>
                  ) : null}
                  {activeConversationSummary ? (
                    <button type="button" className={styles.homeContextCard} onClick={handleResumeConversation}>
                      <span className={styles.homeContextLabel}>Retomar</span>
                      <span className={styles.homeContextValue}>
                        {activeConversationResume?.ctaLabel ?? `${getSavedItemsLabel(activeConversationSummary!.count)} guardados`}
                      </span>
                    </button>
                  ) : null}
                </section>
              ) : null}
            </section>
          </div>
        </div>
      ) : (
        <div className={styles.wizardViewport}>
          <div className={styles.wizardPanelWrap}>
            <WizardScaffold
              key={wizardKey}
              preferredAdvisorId={preferredAdvisorId}
              resumeState={resumeState}
              onExitToEntry={handleReturnToEntry}
              onSaveSession={handleOpenPostSessionCheckin}
              initialInput={wizardInitialInput}
              initialStepInputMode={wizardInitialMode}
              autoSubmitFromEntry={wizardAutoSubmit}
            />
          </div>
        </div>
      )}

      {checkinModalOpen ? (
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
              <p className={styles.checkinEyebrow}>
                {checkinFlow === "post_session" ? "Cierre de sesión" : "Check-in diario"}
              </p>
              <h2 id="daily-checkin-title" className={styles.checkinTitle}>
                {checkinFlow === "post_session" ? "Antes de cerrar, ¿cómo te vas hoy?" : "Antes de empezar, ¿cómo estás hoy?"}
              </h2>
              <p className={styles.checkinSubtitle}>
                {checkinFlow === "post_session"
                  ? "Esto nos ayuda a cerrar la sesión con mejor contexto y a sugerirte cómo seguir después."
                  : "Esto nos ayuda a acompañarte mejor y a sugerirte cuándo conviene responder y cuándo no."}
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
                title="¿Cómo está el vínculo con tu expareja actualmente?"
                options={EX_RELATIONSHIP_OPTIONS}
                value={draftRelationshipLevel}
                onChange={setDraftRelationshipLevel}
                className={styles.checkinQuestionSpanTwo}
              />
              {checkinFlow === "post_session" ? (
                <CheckinSliderQuestion
                  title="¿Cómo te fuiste de esta sesión?"
                  options={SESSION_OUTCOME_OPTIONS}
                  value={draftSessionOutcomeLevel}
                  onChange={setDraftSessionOutcomeLevel}
                  className={styles.checkinQuestionSpanTwo}
                />
              ) : null}

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
                    {draftRecentContact === null ? "Falta elegir" : draftRecentContact ? "Sí" : "No"}
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
                  title="Si esto aplica en tu caso, ¿cómo sentiste la interacción reciente alrededor de tus hijos?"
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
                {checkinFlow === "post_session" ? "Omitir" : "Omitir por hoy"}
              </button>
              <button
                type="button"
                className={styles.checkinPrimary}
                onClick={() => void handleSaveDailyCheckin()}
                disabled={!canSubmitCheckin}
              >
                {checkinSubmitting
                  ? "Guardando..."
                  : checkinFlow === "post_session"
                    ? "Guardar y terminar"
                    : "Guardar y continuar"}
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
