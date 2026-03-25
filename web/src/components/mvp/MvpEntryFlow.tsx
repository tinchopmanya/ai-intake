"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/components/mvp/MvpEntryFlow.module.css";
import { useMvpShell } from "@/components/mvp/MvpShellContext";
import { WizardScaffold } from "@/components/mvp/WizardScaffold";
import { ADVISOR_PROFILES } from "@/data/advisors";

type FlowView = "entry" | "wizard";
type SelectorIntent = "vent" | "write_to_ex";

type MoodOption = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

const DEFAULT_ADVISOR_STORAGE_KEY = "exreply-default-advisor-id";

const MOOD_OPTIONS: MoodOption[] = [
  {
    id: "angry",
    icon: "😤",
    title: "Enojado/a",
    description: "Me sacó algo",
  },
  {
    id: "sad",
    icon: "😔",
    title: "Triste",
    description: "Sin energía para esto",
  },
  {
    id: "confused",
    icon: "😕",
    title: "Confundido/a",
    description: "No sé cómo tomarlo",
  },
  {
    id: "calm",
    icon: "😌",
    title: "Tranquilo/a",
    description: "Quiero manejarlo bien",
  },
];

const ADVISOR_MICROCOPY: Record<string, string> = {
  laura: "Perspectiva empatica - escucha primero",
  robert: "Perspectiva estrategica - limites claros",
  lidia: "Perspectiva directa - al grano",
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

export function MvpEntryFlow() {
  const { displayName, sidebarConversation, openAdvisorConversation } = useMvpShell();
  const [view, setView] = useState<FlowView>("entry");
  const [selectedMoodId, setSelectedMoodId] = useState<string>("calm");
  const [selectorIntent, setSelectorIntent] = useState<SelectorIntent | null>(null);
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>("laura");
  const [rememberAdvisor, setRememberAdvisor] = useState(false);
  const [preferredAdvisorId, setPreferredAdvisorId] = useState<string | null>(null);
  const [wizardKey, setWizardKey] = useState(0);

  useEffect(() => {
    const storedAdvisorId = readStoredAdvisorId();
    if (!storedAdvisorId) return;
    setSelectedAdvisorId(storedAdvisorId);
    setRememberAdvisor(true);
    setPreferredAdvisorId(storedAdvisorId);
  }, []);

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

  function handleConfirmAdvisor() {
    persistAdvisorPreference();
    if (selectorIntent === "vent") {
      openAdvisorConversation(selectedAdvisor.id);
      setSelectorIntent(null);
      return;
    }

    setSelectorIntent(null);
    enterWizard(selectedAdvisor.id);
  }

  function handleAnalyzeConversation() {
    enterWizard(null);
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
                  <h1 className={styles.headline}>¿Cómo estás ahora?</h1>
                  <p className={styles.subcopy}>
                    Antes de continuar, contanos cómo te encontrás.
                  </p>
                </div>

                <div className={styles.moodGrid}>
                  {MOOD_OPTIONS.map((mood) => (
                    <button
                      key={mood.id}
                      type="button"
                      className={`${styles.moodButton} ${
                        selectedMoodId === mood.id ? styles.moodButtonActive : ""
                      }`}
                      onClick={() => setSelectedMoodId(mood.id)}
                    >
                      <span className={styles.moodIcon} aria-hidden="true">
                        {mood.icon}
                      </span>
                      <span className={styles.moodTitle}>{mood.title}</span>
                      <span className={styles.moodText}>{mood.description}</span>
                    </button>
                  ))}
                </div>

                {sidebarConversation && lastSessionMeta ? (
                  <div className={styles.sessionCard}>
                    <span className={styles.sessionDot} aria-hidden="true" />
                    <p className={styles.sessionText}>
                      Última sesión: {lastSessionMeta} · {sidebarConversation.title}
                    </p>
                    <span className={styles.sessionArrow} aria-hidden="true">
                      ›
                    </span>
                  </div>
                ) : null}

                <div className={styles.actions}>
                  <button type="button" className={styles.primaryAction} onClick={() => openSelector("vent")}>
                    <span className={styles.buttonIcon} aria-hidden="true">
                      💬
                    </span>
                    Solo quiero desahogarme
                  </button>
                  <button type="button" className={styles.secondaryAction} onClick={handleAnalyzeConversation}>
                    <span className={styles.buttonIcon} aria-hidden="true">
                      📋
                    </span>
                    Tengo una conversación para analizar
                  </button>
                  <button
                    type="button"
                    className={styles.tertiaryAction}
                    onClick={() => openSelector("write_to_ex")}
                  >
                    <span className={styles.buttonIcon} aria-hidden="true">
                      ✍️
                    </span>
                    Quiero escribirle a mi ex
                  </button>
                </div>

                <p className={styles.disclaimer}>
                  No guardamos conversaciones por defecto · La IA puede equivocarse
                  <br />
                  No reemplaza apoyo <a href="#" className={styles.disclaimerLink}>psicológico</a>, legal ni atención de emergencia
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
            <WizardScaffold key={wizardKey} preferredAdvisorId={preferredAdvisorId} />
          </div>
        </div>
      )}

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
            <div className={styles.sheetHandle} aria-hidden="true" />
            <div className={styles.sheetHeader}>
              <div>
                <h2 id="advisor-selector-title" className={styles.sheetTitle}>
                  {selectorIntent === "vent" ? "Con quien quieres hablar?" : "Con quien quieres escribir?"}
                </h2>
                <p className={styles.sheetSubtitle}>
                  {selectorIntent === "vent"
                    ? "Elige el consejero con el que te sientas mas comodo/a para desahogarte."
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
                const avatarClass =
                  advisor.id === "laura"
                    ? styles.advisorAvatarLaura
                    : advisor.id === "robert"
                      ? styles.advisorAvatarRobert
                      : styles.advisorAvatarLidia;

                return (
                  <button
                    key={advisor.id}
                    type="button"
                    className={`${styles.advisorCard} ${isActive ? styles.advisorCardActive : ""}`}
                    onClick={() => setSelectedAdvisorId(advisor.id)}
                  >
                    <span className={`${styles.advisorAvatar} ${avatarClass}`}>
                      {advisor.id === "lidia" ? "Li" : advisor.name[0]}
                    </span>
                    <span className={styles.advisorTextGroup}>
                      <span className={styles.advisorName}>{advisor.name}</span>
                      <span className={styles.advisorCopy}>{ADVISOR_MICROCOPY[advisor.id]}</span>
                    </span>
                    {isActive ? <span className={styles.advisorSelectedMark}>Elegido</span> : null}
                  </button>
                );
              })}
            </div>

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
                {selectorIntent === "vent" ? "Empezar a hablar" : "Continuar con este consejero"}
              </button>
              <button type="button" className={styles.sheetSecondary} onClick={() => setSelectorIntent(null)}>
                Volver
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
