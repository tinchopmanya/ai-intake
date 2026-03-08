"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

import { advisorProfiles } from "./advisorProfiles";

type AdvisorResult = {
  advisor_id: string;
  advisor_name: string;
  suggestions: string[];
};

type AdvisorResponse = {
  conversation_id: string;
  analysis: string;
  results: AdvisorResult[];
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const ADVISOR_URL = `${API_BASE_URL}/v1/advisor`;

function getAdvisorVisual(advisor: AdvisorResult) {
  const profile = advisorProfiles[advisor.advisor_id];
  if (profile) {
    return profile;
  }
  return {
    id: advisor.advisor_id,
    name: advisor.advisor_name,
    role: "Consejero",
    description: "Perfil sin metadata visual cargada.",
    avatar: "/advisors/generic.svg",
  };
}

export default function AdvisorPage() {
  const [conversationText, setConversationText] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const [copiedSuggestionKey, setCopiedSuggestionKey] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = conversationText.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setCopiedSuggestionKey(null);

    try {
      const response = await fetch(ADVISOR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_text: text,
          context: context.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdvisorResponse;
      setResult(data);
    } catch {
      setError("No se pudo generar sugerencias en este momento.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopySuggestion(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSuggestionKey(key);
      window.setTimeout(() => setCopiedSuggestionKey(null), 1500);
    } catch {
      setError("No se pudo copiar la sugerencia.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 p-6">
      <header className="rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5">
        <h1 className="text-2xl font-bold text-slate-100">Consejero Emocional</h1>
        <p className="mt-1 text-sm text-slate-300">
          Pega una conversacion y recibe sugerencias claras desde distintos perfiles.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/70 p-5"
      >
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            Conversacion
          </label>
          <textarea
            value={conversationText}
            onChange={(event) => setConversationText(event.target.value)}
            placeholder={"Persona A: ...\nPersona B: ..."}
            rows={10}
            className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-800">
            Contexto opcional
          </label>
          <input
            type="text"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Ej: es mi ex, conflicto laboral, quiero empatia pero firmeza"
            className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading || conversationText.trim().length === 0}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Analizando..." : "Generar sugerencias"}
        </button>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {result && (
        <section className="space-y-4">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Sesion {result.conversation_id}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-gray-900">Analisis general</h2>
            <p className="mt-2 text-sm leading-7 text-gray-800">{result.analysis}</p>
          </article>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.results.map((advisor) => {
              const profile = getAdvisorVisual(advisor);
              return (
                <article
                  key={advisor.advisor_id}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <Image
                      src={profile.avatar}
                      alt={profile.name}
                      width={52}
                      height={52}
                      className="rounded-xl border border-gray-200 bg-gray-100"
                    />
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{profile.name}</h3>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                        {profile.role}
                      </p>
                    </div>
                  </div>
                  <p className="mb-3 text-sm text-gray-700">{profile.description}</p>
                  <ul className="space-y-2">
                    {advisor.suggestions.map((suggestion, index) => {
                      const key = `${advisor.advisor_id}-${index}`;
                      return (
                        <li
                          key={key}
                          className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                        >
                          <p className="text-sm leading-6 text-gray-800">{suggestion}</p>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleCopySuggestion(key, suggestion)}
                              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                            >
                              {copiedSuggestionKey === key ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
