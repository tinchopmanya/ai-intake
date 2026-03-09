"use client";

import { useState } from "react";

const steps = [
  { id: "ingreso", label: "Ingreso" },
  { id: "analisis", label: "Analisis" },
  { id: "respuesta", label: "Respuesta" },
] as const;

export function WizardScaffold() {
  const [quickMode, setQuickMode] = useState(false);

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Wizard base</h2>
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
        <p className="text-sm text-gray-700">Pronto: formulario con llamadas a API.</p>
        <ul className="list-disc pl-5 text-sm text-gray-600">
          <li>`POST /v1/analysis` para paso 2</li>
          <li>`POST /v1/advisor` para respuestas</li>
          <li>Boton de copiar sugerencias</li>
        </ul>
      </div>
    </section>
  );
}

