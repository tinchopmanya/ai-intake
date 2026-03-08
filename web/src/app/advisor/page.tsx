"use client";

import { FormEvent, useState } from "react";

type AdvisorResponse = {
  analysis: string;
  suggestions: string[];
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const ADVISOR_URL = `${API_BASE_URL}/v1/advisor`;

export default function AdvisorPage() {
  const [conversationText, setConversationText] = useState("");
  const [context, setContext] = useState("");
  const [tone, setTone] = useState("empathetic");
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationText.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(ADVISOR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_text: conversationText.trim(),
          context: context.trim(),
          tone,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdvisorResponse;
      setResult(data);
    } catch {
      setError("No se pudo generar una sugerencia en este momento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Consejero Personal</h1>
        <p className="mt-1 text-sm text-gray-700">
          Pega una conversacion y recibe analisis breve + sugerencias de respuesta.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded border border-gray-200 bg-gray-50/70 p-4"
      >
        <div>
          <label
            className="mb-2 block text-sm font-semibold text-gray-800"
            htmlFor="conversationText"
          >
            Conversacion
          </label>
          <textarea
            id="conversationText"
            value={conversationText}
            onChange={(event) => setConversationText(event.target.value)}
            placeholder={"Persona A: ...\nPersona B: ..."}
            rows={12}
            className="w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          />
        </div>

        <div>
          <label
            className="mb-2 block text-sm font-semibold text-gray-800"
            htmlFor="context"
          >
            Contexto opcional
          </label>
          <input
            id="context"
            type="text"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Ej: es mi ex, conflicto laboral, quiero empatia pero firmeza"
            className="w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          />
        </div>

        <div>
          <label
            className="mb-2 block text-sm font-semibold text-gray-800"
            htmlFor="tone"
          >
            Tono sugerido
          </label>
          <select
            id="tone"
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            className="w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          >
            <option value="empathetic">Empatico</option>
            <option value="firm">Firme</option>
            <option value="brief">Breve</option>
            <option value="warm">Calido</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading || !conversationText.trim()}
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Analizando..." : "Generar sugerencias"}
        </button>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {result && (
        <section className="space-y-3 rounded border border-gray-200 bg-gray-50/70 p-4">
          <h2 className="text-lg font-semibold text-gray-900">Analisis</h2>
          <p className="text-sm leading-6 text-gray-800">{result.analysis}</p>
          <h3 className="pt-2 text-base font-semibold text-gray-900">Respuestas sugeridas</h3>
          <ul className="space-y-2">
            {result.suggestions.map((suggestion, index) => (
              <li
                key={`${index}-${suggestion}`}
                className="rounded border border-gray-200 bg-white p-3 text-sm leading-6 text-gray-800"
              >
                {suggestion}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
