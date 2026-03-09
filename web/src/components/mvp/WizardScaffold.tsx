"use client";

import { useState } from "react";

import { postAdvisor } from "@/lib/api/client";
import { postAnalysis } from "@/lib/api/client";
import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import { Button } from "@/components/mvp/ui";
import { Panel } from "@/components/mvp/ui";
import { Select } from "@/components/mvp/ui";
import { Textarea } from "@/components/mvp/ui";
import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
import { ADVISOR_PROFILES } from "@/data/advisors";
import type { AdvisorProfile } from "@/data/advisors";
import type { AdvisorResponse } from "@/lib/api/types";
import type { AnalysisResponse } from "@/lib/api/types";
import type { UsageMode } from "@/lib/api/types";

const steps = [
  { id: "ingreso", label: "Ingreso" },
  { id: "analisis", label: "Analisis" },
  { id: "respuesta", label: "Respuesta" },
] as const;

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

function getAdvisorVisualByIndex(index: number) {
  return ADVISOR_PROFILES[index] ?? ADVISOR_FALLBACK_VISUAL;
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
  const [selectedProfile, setSelectedProfile] = useState<AdvisorProfile | null>(null);

  const selectedRecentPerson =
    RECENT_PEOPLE.find((person) => person.id === selectedRecentPersonId) ?? null;

  function buildContextPayload() {
    const context: Record<string, unknown> = {};
    if (contextOptional.trim()) context.contact_context = contextOptional.trim();
    if (selectedRecentPerson) context.recent_person = selectedRecentPerson.name;
    return Object.keys(context).length > 0 ? context : undefined;
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

  function handleContinue() {
    if (!messageText.trim()) return;
    setAnalysisResult(null);
    setAnalysisId(null);
    setAnalysisError(null);
    setCurrentStep(2);
  }

  async function handleRunAnalysis() {
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

  async function handleContinueToStep3() {
    if (!analysisId) return;
    await requestAdvisor({ quickMode: false, analysisId });
  }

  async function handleCopy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 1200);
    } catch {
      setAdvisorError("No se pudo copiar la respuesta.");
    }
  }

  return (
    <Panel className="space-y-4 p-3 md:p-4">
      <header className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Wizard advisor</h2>
          <p className="text-sm text-gray-600">
            Flujo de 3 pasos para analizar y generar respuestas.
          </p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isActive = currentStep === stepNumber;
            const isPast = currentStep > stepNumber;
            const hiddenByQuick = quickMode && step.id === "analisis";
            return (
              <li
                key={step.id}
                className={`rounded-xl border px-3 py-2 text-sm transition ${
                  hiddenByQuick
                    ? "border-dashed border-gray-300 bg-gray-50 text-gray-400"
                    : isActive
                      ? "border-gray-400 bg-gray-200/70 text-gray-800"
                      : isPast
                        ? "border-gray-300 bg-gray-100 text-gray-700"
                        : "border-gray-300 bg-gray-50 text-gray-700"
                }`}
              >
                Paso {stepNumber}: {step.label}
                {hiddenByQuick ? " (omitido)" : ""}
              </li>
            );
          })}
        </ol>
      </header>

      {currentStep === 1 ? (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">Paso 1: Ingreso</h3>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={quickMode}
                onChange={(event) => setQuickMode(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Quick mode
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_210px] lg:items-start">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Mensaje</label>
              <Textarea
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                rows={5}
                placeholder="Pega aqui el mensaje a responder o revisar..."
              />
            </div>
            <aside className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Personas recientes
              </p>
              <ul className="mt-2 space-y-1.5">
                {RECENT_PEOPLE.map((person) => {
                  const isSelected = selectedRecentPersonId === person.id;
                  return (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedRecentPersonId(person.id)}
                        className={`w-full rounded-md border px-2 py-1 text-left text-xs transition ${
                          isSelected
                            ? "border-gray-300 bg-gray-200/70 text-gray-800"
                            : "border-transparent bg-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {person.name} - {person.context}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {selectedRecentPerson && (
                <p className="mt-2 text-xs text-gray-600">
                  Asociado a: {selectedRecentPerson.name} - {selectedRecentPerson.context}
                </p>
              )}
            </aside>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Contexto opcional</label>
              <Textarea
                value={contextOptional}
                onChange={(event) => setContextOptional(event.target.value)}
                rows={2}
                placeholder="Ej: conflicto familiar, quiero responder con firmeza sin escalar"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Modo</label>
              <Select
                value={mode}
                onChange={(event) => setMode(event.target.value as UsageMode)}
                className="max-w-full"
              >
                <option value="reactive">reactive</option>
                <option value="preventive">preventive</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleContinue}
              disabled={!messageText.trim()}
              variant="primary"
            >
              Continuar
            </Button>
            <Button
              type="button"
              onClick={handleQuickResponse}
              disabled={!messageText.trim() || loadingAdvisor}
              variant="secondary"
            >
              {loadingAdvisor ? "Generando..." : "Respuesta rapida"}
            </Button>
          </div>
          {advisorError && <p className="text-sm text-red-700">{advisorError}</p>}
        </>
      ) : currentStep === 2 ? (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-gray-800">Paso 2: Analisis</h3>
          <p className="text-sm text-gray-700">Ejecuta el analisis del mensaje antes de generar respuesta.</p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => setCurrentStep(1)}
              variant="secondary"
            >
              Volver
            </Button>
            <Button
              type="button"
              onClick={handleRunAnalysis}
              disabled={!messageText.trim() || loadingAnalysis}
              variant="primary"
            >
              {loadingAnalysis ? "Analizando..." : "Ejecutar analisis"}
            </Button>
            <Button
              type="button"
              onClick={handleContinueToStep3}
              disabled={!analysisId || loadingAdvisor}
              variant="secondary"
            >
              {loadingAdvisor ? "Generando..." : "Continuar al paso 3"}
            </Button>
          </div>

          {analysisError && <p className="text-sm text-red-700">{analysisError}</p>}
          {advisorError && <p className="text-sm text-red-700">{advisorError}</p>}

          {analysisResult && (
            <div className="grid gap-3 lg:grid-cols-4">
              <article className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Summary
                </p>
                <p className="mt-1 text-sm text-gray-800">{analysisResult.summary}</p>
              </article>
              <article className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Emotional context
                </p>
                <p className="mt-1 text-sm text-gray-800">
                  tone: {analysisResult.emotional_context.tone}
                </p>
                <p className="text-sm text-gray-800">
                  intent: {analysisResult.emotional_context.intent_guess}
                </p>
              </article>
              <article className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Risk flags
                </p>
                {analysisResult.risk_flags.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-700">Sin flags.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                    {analysisResult.risk_flags.map((flag) => (
                      <li key={`${flag.code}-${flag.severity}`}>
                        {flag.code} ({flag.severity})
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  UI alerts
                </p>
                {analysisResult.ui_alerts.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-700">Sin alertas.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                    {analysisResult.ui_alerts.map((alert, index) => (
                      <li key={`${alert.level}-${index}`}>{alert.message}</li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-gray-800">Paso 3: Respuesta</h3>
          {advisorError && <p className="text-sm text-red-700">{advisorError}</p>}

          <div className="grid gap-3 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => {
              const advisorVisual = getAdvisorVisualByIndex(index);
              const responseText = advisorResult?.responses[index]?.text ?? "";
              return (
                <article
                  key={`${advisorVisual.id}-${index}`}
                  className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3"
                >
                  <header>
                    <AdvisorAvatarItem
                      name={advisorVisual.name}
                      role={advisorVisual.role}
                      avatarSrc={advisorVisual.avatar64}
                      size={64}
                      onClick={() => {
                        const profile = ADVISOR_PROFILES.find(
                          (item) => item.id === advisorVisual.id,
                        );
                        setSelectedProfile(profile ?? null);
                      }}
                    />
                  </header>
                  <p className="text-sm text-gray-800">
                    {responseText || "Sin respuesta disponible."}
                  </p>
                  <Button
                    type="button"
                    onClick={() => handleCopy(responseText, index)}
                    disabled={!responseText}
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                  >
                    {copiedIndex === index ? "Copiado" : "Copiar"}
                  </Button>
                </article>
              );
            })}
          </div>

          <Button
            type="button"
            onClick={() => setCurrentStep(2)}
            variant="secondary"
          >
            Volver al paso 2
          </Button>
        </div>
      )}
      <AdvisorProfileModal
        profile={selectedProfile}
        onClose={() => setSelectedProfile(null)}
      />
    </Panel>
  );
}

