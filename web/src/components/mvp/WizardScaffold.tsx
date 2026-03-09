"use client";

import { useState } from "react";

import { postAdvisor } from "@/lib/api/client";
import { postAnalysis } from "@/lib/api/client";
import type { AdvisorResponse } from "@/lib/api/types";
import type { AnalysisResponse } from "@/lib/api/types";
import type { UsageMode } from "@/lib/api/types";

const steps = [
  { id: "ingreso", label: "Ingreso" },
  { id: "analisis", label: "Analisis" },
  { id: "respuesta", label: "Respuesta" },
] as const;

export function WizardScaffold() {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [messageText, setMessageText] = useState("");
  const [mode, setMode] = useState<UsageMode>("reactive");
  const [quickMode, setQuickMode] = useState(false);
  const [loadingQuickResponse, setLoadingQuickResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickResponseResult, setQuickResponseResult] = useState<AdvisorResponse | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  async function handleQuickResponse() {
    const text = messageText.trim();
    if (!text || loadingQuickResponse) return;

    setLoadingQuickResponse(true);
    setError(null);
    setQuickResponseResult(null);

    try {
      const result = await postAdvisor({
        message_text: text,
        mode,
        relationship_type: "familia",
        quick_mode: true,
      });
      setQuickResponseResult(result);
    } catch {
      setError("No se pudo generar respuesta rapida.");
    } finally {
      setLoadingQuickResponse(false);
    }
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
      });
      setAnalysisResult(result);
      setAnalysisId(result.analysis_id);
    } catch {
      setAnalysisError("No se pudo ejecutar el analisis.");
    } finally {
      setLoadingAnalysis(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 p-4">
      {currentStep === 1 ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">Paso 1: Ingreso</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={quickMode}
                onChange={(event) => setQuickMode(event.target.checked)}
              />
              Quick mode
            </label>
          </div>

          <ol className="grid gap-2 sm:grid-cols-3">
            {steps.map((step, index) => {
              const hiddenByQuick = quickMode && step.id === "analisis";
              return (
                <li
                  key={step.id}
                  className={`rounded border px-3 py-2 text-sm ${
                    hiddenByQuick ? "border-dashed text-gray-400" : "border-gray-300"
                  }`}
                >
                  Paso {index + 1}: {step.label}
                  {hiddenByQuick ? " (omitido)" : ""}
                </li>
              );
            })}
          </ol>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Mensaje</label>
            <textarea
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              rows={8}
              placeholder="Pega aqui el mensaje a responder o revisar..."
              className="w-full rounded border border-gray-300 p-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Modo</label>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as UsageMode)}
              className="w-full max-w-xs rounded border border-gray-300 p-2 text-sm"
            >
              <option value="reactive">reactive</option>
              <option value="preventive">preventive</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleContinue}
              disabled={!messageText.trim()}
              className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={handleQuickResponse}
              disabled={!messageText.trim() || loadingQuickResponse}
              className="rounded border border-black px-4 py-2 text-sm disabled:opacity-50"
            >
              {loadingQuickResponse ? "Generando..." : "Respuesta rapida"}
            </button>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          {quickResponseResult && (
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium">Respuesta rapida generada</p>
              <p className="mt-1 text-xs text-gray-600">
                session_id: {quickResponseResult.session_id}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {quickResponseResult.responses.map((item, index) => (
                  <li key={`${item.emotion_label}-${index}`}>{item.text}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : currentStep === 2 ? (
        <div className="space-y-3">
          <h2 className="text-base font-medium">Paso 2: Analisis</h2>
          <p className="text-sm text-gray-700">Ejecuta el analisis del mensaje antes de generar respuesta.</p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={!messageText.trim() || loadingAnalysis}
              className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {loadingAnalysis ? "Analizando..." : "Ejecutar analisis"}
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              disabled={!analysisId}
              className="rounded border border-black px-4 py-2 text-sm disabled:opacity-50"
            >
              Continuar al paso 3
            </button>
          </div>

          {analysisError && <p className="text-sm text-red-700">{analysisError}</p>}

          {analysisResult && (
            <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-600">analysis_id: {analysisResult.analysis_id}</p>

              <div>
                <p className="text-sm font-medium">Summary</p>
                <p className="text-sm text-gray-800">{analysisResult.summary}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Emotional context</p>
                <p className="text-sm text-gray-800">
                  tone: {analysisResult.emotional_context.tone}
                </p>
                <p className="text-sm text-gray-800">
                  intent: {analysisResult.emotional_context.intent_guess}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Risk flags</p>
                {analysisResult.risk_flags.length === 0 ? (
                  <p className="text-sm text-gray-700">Sin flags.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm text-gray-800">
                    {analysisResult.risk_flags.map((flag) => (
                      <li key={`${flag.code}-${flag.severity}`}>
                        {flag.code} ({flag.severity}) - conf: {flag.confidence}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-sm font-medium">UI alerts</p>
                {analysisResult.ui_alerts.length === 0 ? (
                  <p className="text-sm text-gray-700">Sin alertas.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm text-gray-800">
                    {analysisResult.ui_alerts.map((alert, index) => (
                      <li key={`${alert.level}-${index}`}>
                        [{alert.level}] {alert.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-base font-medium">Paso 3: Respuesta</h2>
          <p className="text-sm text-gray-700">Base lista para integrar /v1/advisor con analysis_id.</p>
          <p className="text-xs text-gray-600">
            analysis_id en estado global: {analysisId ?? "sin analisis"}
          </p>
          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            Volver al paso 2
          </button>
        </div>
      )}
    </section>
  );
}

