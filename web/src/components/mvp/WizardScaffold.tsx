"use client";

import { useState } from "react";

import { postAdvisor } from "@/lib/api/client";
import type { AdvisorResponse } from "@/lib/api/types";
import type { UsageMode } from "@/lib/api/types";

const steps = [
  { id: "ingreso", label: "Ingreso" },
  { id: "analisis", label: "Analisis" },
  { id: "respuesta", label: "Respuesta" },
] as const;

export function WizardScaffold() {
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [messageText, setMessageText] = useState("");
  const [mode, setMode] = useState<UsageMode>("reactive");
  const [quickMode, setQuickMode] = useState(false);
  const [loadingQuickResponse, setLoadingQuickResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickResponseResult, setQuickResponseResult] = useState<AdvisorResponse | null>(null);

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
    setCurrentStep(2);
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
      ) : (
        <div className="space-y-3">
          <h2 className="text-base font-medium">Paso 2: Analisis</h2>
          <p className="text-sm text-gray-700">
            Navegacion lista. En este paso se conectara `POST /v1/analysis`.
          </p>
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            Volver al paso 1
          </button>
        </div>
      )}
    </section>
  );
}

