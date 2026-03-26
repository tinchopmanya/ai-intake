"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import styles from "@/components/mvp/MvpEntryFlow.module.css";
import { useMvpShell } from "@/components/mvp/MvpShellContext";
import { WizardScaffold } from "@/components/mvp/WizardScaffold";
import { ADVISOR_PROFILES } from "@/data/advisors";

type FlowView = "entry" | "wizard";
type SelectorIntent = "vent" | "write_to_ex";

type SliderOption = {
  id: string;
  label: string;
};

const DEFAULT_ADVISOR_STORAGE_KEY = "exreply-default-advisor-id";

const MOOD_OPTIONS: SliderOption[] = [
  { id: "angry", label: "Enojado" },
  { id: "sad", label: "Triste" },
  { id: "normal", label: "Normal" },
  { id: "pretty_good", label: "Bastante bien" },
  { id: "excellent", label: "Excelente" },
];

const SELF_ESTEEM_OPTIONS: SliderOption[] = [
  { id: "very_low", label: "Muy baja" },
  { id: "low", label: "Baja" },
  { id: "normal", label: "Normal" },
  { id: "good", label: "Bien" },
  { id: "high", label: "Alta" },
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

function SliderPlaceholderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.sliderPlaceholderIcon}>
      <path
        d="M7 16.5 10 13.5l2.5 2.5 4.5-4.5 2 2v3.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
      <path
        d="M15.5 7.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
      />
    </svg>
  );
}

function EntrySlider({
  question,
  options,
  value,
  onChange,
}: {
  question: string;
  options: SliderOption[];
  value: number;
  onChange: (nextValue: number) => void;
}) {
  const thumbPosition = `${(value / Math.max(options.length - 1, 1)) * 100}%`;
  const sliderStyle = { "--thumb-position": thumbPosition } as CSSProperties;
  const activeLabel = options[value]?.label ?? "";

  return (
    <section className={styles.sliderSection}>
      <div className={styles.sliderHeader}>
        <div>
          <h2 className={styles.sliderQuestion}>{question}</h2>
          <p className={styles.sliderSupport}>Ajusta el punto que mejor te represente ahora.</p>
        </div>
        <span className={styles.sliderValue}>{activeLabel}</span>
      </div>

      <div className={styles.sliderFigure} style={sliderStyle}>
        <div className={styles.sliderThumbStage} aria-hidden="true">
          <div className={styles.sliderThumbPlaceholder}>
            <SliderPlaceholderIcon />
            <span>Imagen</span>
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className={styles.sliderControl}
          aria-label={question}
        />
      </div>

      <div className={styles.sliderLabels}>
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(index)}
            className={`${styles.sliderLabelButton} ${value === index ? styles.sliderLabelButtonActive : ""}`}
            aria-pressed={value === index}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function MvpEntryFlow() {
  const { displayName, sidebarConversation, openAdvisorConversation } = useMvpShell();
  const [view, setView] = useState<FlowView>("entry");
  const [selectedMoodIndex, setSelectedMoodIndex] = useState(2);
  const [selectedSelfEsteemIndex, setSelectedSelfEsteemIndex] = useState(2);
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

  function handleReturnToEntry() {
    setPreferredAdvisorId(null);
    setSelectorIntent(null);
    setView("entry");
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
                  <h1 className={styles.headline}>Como te sientes ahora?</h1>
                  <p className={styles.subcopy}>
                    Antes de continuar, marca dos referencias rapidas y elige como quieres avanzar.
                  </p>
                </div>

                <div className={styles.sliderStack}>
                  <EntrySlider
                    question="Como esta tu estado de animo?"
                    options={MOOD_OPTIONS}
                    value={selectedMoodIndex}
                    onChange={setSelectedMoodIndex}
                  />
                  <EntrySlider
                    question="Como esta tu autoestima?"
                    options={SELF_ESTEEM_OPTIONS}
                    value={selectedSelfEsteemIndex}
                    onChange={setSelectedSelfEsteemIndex}
                  />
                </div>

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
                      <span className={styles.actionCopy}>Abrir un espacio breve para descargar y ordenar.</span>
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
