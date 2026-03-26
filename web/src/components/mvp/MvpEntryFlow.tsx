"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/mvp/MvpEntryFlow.module.css";
import { useMvpShell } from "@/components/mvp/MvpShellContext";
import { WizardScaffold } from "@/components/mvp/WizardScaffold";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { getEmotionalCheckinToday, postEmotionalCheckin } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import type { EmotionalCheckinSummary } from "@/lib/api/types";

type FlowView = "entry" | "wizard";
type SelectorIntent = "vent" | "write_to_ex";
type SelectorCardVariant = "calm" | "structured" | "direct";

type CheckinOption = {
  value: number;
  label: string;
};

const DEFAULT_ADVISOR_STORAGE_KEY = "exreply-default-advisor-id";

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

const ADVISOR_MICROCOPY: Record<string, string> = {
  laura: "Espacio breve para bajar intensidad y ordenar lo que sientes.",
  robert: "Mirada clara para poner foco y recuperar perspectiva.",
  lidia: "Acompanamiento concreto para descargar sin dar mas vueltas.",
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
  if (hour < 12) return "Buen dia";
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

function CheckinQuestion({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: CheckinOption[];
  value: number | null;
  onChange: (nextValue: number) => void;
}) {
  return (
    <section className={styles.checkinQuestionBlock}>
      <p className={styles.checkinQuestionTitle}>{title}</p>
      <div className={styles.checkinOptionGrid}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`${styles.checkinOptionButton} ${value === option.value ? styles.checkinOptionButtonActive : ""}`}
            aria-pressed={value === option.value}
          >
            <span className={styles.checkinOptionValue}>{option.value}</span>
            <span className={styles.checkinOptionLabel}>{option.label}</span>
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
  const { displayName, sidebarConversation, openAdvisorConversation } = useMvpShell();
  const [view, setView] = useState<FlowView>("entry");
  const [selectorIntent, setSelectorIntent] = useState<SelectorIntent | null>(null);
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>("laura");
  const [rememberAdvisor, setRememberAdvisor] = useState(false);
  const [preferredAdvisorId, setPreferredAdvisorId] = useState<string | null>(null);
  const [wizardKey, setWizardKey] = useState(0);
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  const [checkinDismissedForVisit, setCheckinDismissedForVisit] = useState(false);
  const [checkinSubmitting, setCheckinSubmitting] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [todayCheckin, setTodayCheckin] = useState<EmotionalCheckinSummary | null>(null);
  const [draftMoodLevel, setDraftMoodLevel] = useState<number | null>(null);
  const [draftConfidenceLevel, setDraftConfidenceLevel] = useState<number | null>(null);
  const [draftRecentContact, setDraftRecentContact] = useState<boolean | null>(null);

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
        setTodayCheckin(response.today_checkin ?? null);
        setCheckinModalOpen(!response.has_checkin_today && !checkinDismissedForVisit);
      } catch {
        if (!mounted) return;
        setCheckinModalOpen(false);
      }
    }
    void loadTodayCheckin();
    return () => {
      mounted = false;
    };
  }, [checkinDismissedForVisit]);

  useEffect(() => {
    function handleNewConversation() {
      setSelectorIntent(null);
      setView("entry");
    }

    window.addEventListener("mvp:new-conversation", handleNewConversation);
    return () => {
      window.removeEventListener("mvp:new-conversation", handleNewConversation);
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
    return `Hoy: animo ${moodLabel} \u00b7 confianza ${confidenceLabel}`;
  }, [todayCheckin]);

  const canSubmitCheckin =
    draftMoodLevel !== null && draftConfidenceLevel !== null && draftRecentContact !== null && !checkinSubmitting;

  function openSelector(intent: SelectorIntent) {
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

  function enterWizard(nextPreferredAdvisorId: string | null) {
    setPreferredAdvisorId(nextPreferredAdvisorId);
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
    setPreferredAdvisorId(null);
    setSelectorIntent(null);
    setView("entry");
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
      });
      setTodayCheckin(created);
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
                  <h1 className={styles.headline}>\u00bfComo quieres empezar hoy?</h1>
                  <p className={styles.subcopy}>
                    Usa ExReply para descargar, analizar una conversacion o preparar mejor tu siguiente mensaje.
                  </p>
                </div>

                {checkinSummaryLine ? (
                  <div className={styles.daySummaryCard}>
                    <span className={styles.daySummaryDot} aria-hidden="true" />
                    <p className={styles.daySummaryText}>{checkinSummaryLine}</p>
                  </div>
                ) : null}

                {sidebarConversation && lastSessionMeta ? (
                  <div className={styles.sessionCard}>
                    <span className={styles.sessionDot} aria-hidden="true" />
                    <p className={styles.sessionText}>
                      Ultima sesion: {lastSessionMeta} - {sidebarConversation.title}
                    </p>
                  </div>
                ) : null}

                <div className={styles.actionsHeader}>
                  <p className={styles.actionsKicker}>Quiero empezar por...</p>
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
                      <span className={styles.actionCopy}>Abrir directo un espacio breve para descargar y ordenar.</span>
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
                      <span className={styles.actionTitle}>Tengo una conversacion para analizar</span>
                      <span className={styles.actionCopy}>Entrar directo al wizard actual con el flujo existente.</span>
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
                      <span className={styles.actionCopy}>Elegir consejero y luego seguir con la escritura guiada.</span>
                    </span>
                  </button>
                </div>

                <p className={styles.disclaimer}>
                  No guardamos conversaciones por defecto - La IA puede equivocarse
                  <br />
                  No reemplaza apoyo <a href="#" className={styles.disclaimerLink}>psicologico</a>, legal ni atencion de emergencia
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
                Entraras al flujo actual de analisis y despues podras afinar con{" "}
                {ADVISOR_PROFILES.find((advisor) => advisor.id === preferredAdvisorId)?.name ?? "tu consejero"}.
              </p>
              <p className={styles.intentText}>
                No creamos un flujo nuevo: estamos reutilizando el wizard actual y marcando tu consejero
                elegido para la parte de respuesta.
              </p>
            </section>
          ) : null}

          <div className={styles.wizardPanelWrap}>
            <WizardScaffold
              key={wizardKey}
              preferredAdvisorId={preferredAdvisorId}
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
                Antes de empezar, \u00bfcomo estas hoy?
              </h2>
              <p className={styles.checkinSubtitle}>
                Esto nos ayuda a acompa\u00f1arte mejor y a sugerirte cu\u00e1ndo conviene responder y cu\u00e1ndo no.
              </p>
            </div>

            <div className={styles.checkinBody}>
              <CheckinQuestion
                title="\u00bfComo estas emocionalmente para afrontar el dia?"
                options={DAILY_MOOD_OPTIONS}
                value={draftMoodLevel}
                onChange={setDraftMoodLevel}
              />

              <CheckinQuestion
                title="\u00bfComo sientes tu confianza hoy?"
                options={DAILY_CONFIDENCE_OPTIONS}
                value={draftConfidenceLevel}
                onChange={setDraftConfidenceLevel}
              />

              <section className={styles.checkinQuestionBlock}>
                <p className={styles.checkinQuestionTitle}>
                  \u00bfTuviste contacto con tu ex en las ultimas 12 horas?
                </p>
                <div className={styles.binaryOptionRow}>
                  <button
                    type="button"
                    className={`${styles.binaryOptionButton} ${draftRecentContact === true ? styles.binaryOptionButtonActive : ""}`}
                    onClick={() => setDraftRecentContact(true)}
                    aria-pressed={draftRecentContact === true}
                  >
                    Si
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
            </div>

            {checkinError ? <p className={styles.checkinError}>{checkinError}</p> : null}

            <div className={styles.checkinActions}>
              <button
                type="button"
                className={styles.checkinPrimary}
                onClick={() => void handleSaveDailyCheckin()}
                disabled={!canSubmitCheckin}
              >
                {checkinSubmitting ? "Guardando..." : "Guardar y continuar"}
              </button>
              <button type="button" className={styles.checkinSecondary} onClick={handleSkipCheckinForVisit}>
                Omitir por hoy
              </button>
            </div>
          </section>
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
                    ? "\u00bfCon quien quieres hablar ahora?"
                    : "\u00bfCon quien quieres escribir?"}
                </h2>
                <p className={styles.sheetSubtitle}>
                  {selectorIntent === "vent"
                    ? "Elige una perspectiva y entra directo al espacio de conversacion."
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
