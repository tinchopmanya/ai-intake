"use client";

import Image from "next/image";
import { useState } from "react";

import { Button, Panel, Select, Textarea } from "@/components/mvp/ui";
import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { postAdvisor, postAnalysis } from "@/lib/api/client";
import type { AdvisorResponse, AnalysisResponse, AnalysisRiskFlag, UsageMode } from "@/lib/api/types";

const ADVISOR_FALLBACK_VISUAL = {
  id: "generic",
  name: "Advisor",
  role: "Perspectiva",
  avatar64: "/advisors/generic.svg",
};

const RECENT_PEOPLE = [
  { id: "marcela", name: "Marcela", context: "Ex pareja" },
  { id: "maria", name: "Maria", context: "Amiga" },
  { id: "julio", name: "Julio", context: "Jefe" },
] as const;

const responseStyleBadgeByIndex = ["Empatica", "Estrategica", "Directa"] as const;

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

function getAdvisorVisualByIndex(index: number) {
  return ADVISOR_PROFILES[index] ?? ADVISOR_FALLBACK_VISUAL;
}

function hasRelevantRisk(flags: AnalysisRiskFlag[]) {
  return flags.some((flag) => flag.severity === "medium" || flag.severity === "high");
}

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

function Stepper({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const steps = [
    { id: 1, label: "Ingreso" },
    { id: 2, label: "Analisis" },
    { id: 3, label: "Respuestas" },
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

export function WizardScaffold() {
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
  const [selectedRecentPersonId, setSelectedRecentPersonId] = useState<string | null>(null);

  const selectedRecentPerson =
    RECENT_PEOPLE.find((person) => person.id === selectedRecentPersonId) ?? null;

  function buildContextPayload() {
    const context: Record<string, unknown> = {};
    if (contextOptional.trim()) context.contact_context = contextOptional.trim();
    if (selectedRecentPerson) context.recent_person = selectedRecentPerson.name;
    return Object.keys(context).length > 0 ? context : undefined;
  }

  async function runAnalysis() {
    const text = messageText.trim();
    if (!text || loadingAnalysis) return;

    setLoadingAnalysis(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    setAnalysisId(null);

    try {
      const result = await postAnalysis({
        message_text: text,
        mode,
        relationship_type: "otro",
        quick_mode: quickMode,
        context: buildContextPayload(),
      });
      setAnalysisResult(result);
      setAnalysisId(result.analysis_id);
    } catch {
      setAnalysisError("No se pudo ejecutar el analisis.");
    } finally {
      setLoadingAnalysis(false);
    }
  }

  async function requestAdvisor(params: { quickMode: boolean; analysisId?: string | null }) {
    const text = messageText.trim();
    if (!text || loadingAdvisor) return;

    setLoadingAdvisor(true);
    setAdvisorError(null);
    setAdvisorResult(null);
    setCopiedIndex(null);

    try {
      const result = await postAdvisor({
        message_text: text,
        mode,
        relationship_type: "otro",
        quick_mode: params.quickMode,
        analysis_id: params.analysisId ?? undefined,
        context: buildContextPayload(),
      });
      setAdvisorResult(result);
      setCurrentStep(3);
    } catch {
      setAdvisorError("No se pudo generar respuestas de advisor.");
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
    setSelectedRecentPersonId(null);
    setCopiedIndex(null);
  }

  async function handleCopy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setAdvisorError("No se pudo copiar la respuesta.");
    }
  }

  const analysisStatus = analysisResult ? getAnalysisStatus(analysisResult) : null;

  return (
    <Panel className="mx-auto w-full min-w-0 space-y-5 overflow-x-hidden border-[#e5e7eb] bg-white p-4 shadow-sm sm:p-5">
      <Stepper currentStep={currentStep} />

      {currentStep === 1 ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-[#1f2937]">Paso 1: Ingreso</h3>
              <p className="mt-1 text-sm text-[#334155]">
                Pega el mensaje y define el enfoque antes de analizarlo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#334155]">
              <span className="font-medium text-[#1f2937]">Responderas con ayuda de</span>
              {ADVISOR_PROFILES.map((advisor) => (
                <div key={advisor.id} className="flex items-center gap-2">
                  <Image
                    src={advisor.avatar64}
                    alt={advisor.name}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full border border-[#dbe3ec] object-cover"
                  />
                  <span>{advisor.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-start">
            <div className="min-w-0 space-y-3">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1f2937]">Mensaje</label>
                <Textarea
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  rows={6}
                  placeholder="Pega aqui el mensaje a responder o revisar..."
                  className="min-h-[164px] rounded-xl border-[#e5e7eb] bg-white text-[#1f2937] focus:border-[#3b82f6] focus:ring-[#3b82f6]/20"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px] md:items-end">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#1f2937]">
                    Contexto opcional
                  </label>
                  <Textarea
                    value={contextOptional}
                    onChange={(event) => setContextOptional(event.target.value)}
                    rows={2}
                    placeholder="Ej: quiero responder con firmeza sin escalar"
                    className="border-[#e5e7eb] bg-white text-[#1f2937]"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] md:grid-cols-1">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-[#1f2937]">Modo</label>
                    <Select
                      value={mode}
                      onChange={(event) => setMode(event.target.value as UsageMode)}
                      className="max-w-full border-[#e5e7eb] bg-white text-[#1f2937]"
                    >
                      <option value="reactive">Reactivo</option>
                      <option value="preventive">Preventivo</option>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex min-h-10 flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={handleContinueFromStep1}
                  disabled={!messageText.trim() || loadingAnalysis}
                  variant="primary"
                  className="min-w-[170px] bg-[#1f2937] hover:bg-[#111827]"
                >
                  {loadingAnalysis ? "Analizando conversacion..." : "Continuar"}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setQuickMode(true);
                    void handleQuickResponse();
                  }}
                  disabled={!messageText.trim() || loadingAdvisor}
                  variant="secondary"
                  className="min-w-[170px] border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
                >
                  {loadingAdvisor ? "Generando respuestas..." : "Respuesta rapida"}
                </Button>
              </div>

              <div className="min-h-5">
                {advisorError ? <p className="text-sm text-red-700">{advisorError}</p> : null}
              </div>
            </div>

            <aside className="rounded-2xl border border-[#e5e7eb] bg-[#f8fafc] p-3">
              <h4 className="text-sm font-semibold text-[#1f2937]">Personas recientes</h4>
              <ul className="mt-3 space-y-2">
                {RECENT_PEOPLE.map((person) => {
                  const isSelected = selectedRecentPersonId === person.id;
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedRecentPersonId(person.id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                          isSelected
                            ? "border-[#cbd5e1] bg-white text-[#1f2937]"
                            : "border-transparent bg-white/60 text-[#334155] hover:border-[#dbe3ec] hover:bg-white"
                        }`}
                      >
                        <span className="block font-medium">{person.name}</span>
                        <span className="block text-xs text-gray-500">{person.context}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 min-h-5">
                {selectedRecentPerson ? (
                  <p className="text-xs text-[#334155]">
                    Asociado a <span className="font-medium">{selectedRecentPerson.name}</span>.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Seleccion opcional para dar mas contexto.</p>
                )}
              </div>
            </aside>
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
                  {loadingAdvisor ? "Generando respuestas..." : "Continuar"}
                </Button>
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

              return (
                <article
                  key={`${advisorVisual.id}-${index}`}
                  className={`flex min-w-0 flex-col rounded-2xl border border-[#e5e7eb] bg-white p-3 shadow-sm ${ADVISOR_ACCENT_CLASS[index]}`}
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
                        />
                      </div>
                      <span className="shrink-0 rounded-full bg-white/15 px-2 py-1 text-[11px] font-medium text-white">
                        {responseStyleBadgeByIndex[index]}
                      </span>
                    </div>
                  </header>

                  <p className="mt-4 flex-1 break-words text-[15px] leading-7 text-[#1f2937]">
                    {responseText || "Sin respuesta disponible."}
                  </p>

                  <div className="mt-5 flex justify-end">
                    <Button
                      type="button"
                      onClick={() => handleCopy(responseText, index)}
                      disabled={!responseText}
                      variant="secondary"
                      className={`px-3 py-2 text-sm ${
                        copiedIndex === index
                          ? "border-[#10b981] bg-[#ecfdf5] text-[#047857] hover:bg-[#ecfdf5]"
                          : "border-[#cbd5e1] bg-white text-[#334155] hover:bg-[#f8fafc]"
                      }`}
                    >
                      {copiedIndex === index ? "✓ Copiado" : "📋 Copiar"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
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
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
