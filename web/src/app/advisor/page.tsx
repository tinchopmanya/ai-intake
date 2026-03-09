"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";

import { SYSTEM_ADVISORS, SystemAdvisor } from "@/components/advisor/systemAdvisors";

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

type PerspectiveContent = {
  reflection: string | null;
  suggestedReply: string | null;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const ADVISOR_URL = `${API_BASE_URL}/v1/advisor`;

const ROLE_BY_ADVISOR: Record<string, string> = {
  laura: "Perspectiva empatica",
  robert: "Perspectiva estrategica",
  lidia: "Perspectiva directa",
};

function getPerspectiveContent(result: AdvisorResult | undefined): PerspectiveContent {
  if (!result || result.suggestions.length === 0) {
    return { reflection: null, suggestedReply: null };
  }

  const reflectionItem = result.suggestions.find((item) =>
    item.toLowerCase().startsWith("reflexion:"),
  );
  const reflection = reflectionItem
    ? reflectionItem.replace(/^reflexion:\s*/i, "").trim()
    : null;

  const remaining = result.suggestions.filter((item) => item !== reflectionItem);
  const suggestedReply = (remaining[0] ?? result.suggestions[0])?.trim() ?? null;

  return { reflection, suggestedReply };
}

export default function AdvisorPage() {
  const [conversationText, setConversationText] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expandedAdvisorId, setExpandedAdvisorId] = useState<string | null>("laura");
  const [copiedAdvisorId, setCopiedAdvisorId] = useState<string | null>(null);

  const resultsByAdvisorId = useMemo(() => {
    const map = new Map<string, AdvisorResult>();
    for (const item of result?.results ?? []) {
      map.set(item.advisor_id, item);
    }
    return map;
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = conversationText.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setCopiedAdvisorId(null);

    try {
      const response = await fetch(ADVISOR_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          conversation_text: text,
          context: context.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdvisorResponse;
      setResult(data);
      setConversationId(data.conversation_id);
      setExpandedAdvisorId("laura");
    } catch {
      setError("No se pudo analizar la conversacion en este momento.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyReply(advisorId: string, reply: string | null) {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopiedAdvisorId(advisorId);
      window.setTimeout(() => setCopiedAdvisorId(null), 1500);
    } catch {
      setError("No se pudo copiar la respuesta.");
    }
  }

  function toggleAdvisor(advisorId: string) {
    setExpandedAdvisorId((current) => (current === advisorId ? null : advisorId));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-5 md:p-6">
      <header className="rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4">
        <h1 className="text-2xl font-bold text-slate-100">Consejero de conversaciones</h1>
        <p className="mt-1 text-sm text-slate-300">
          Pega una conversacion dificil y explora tres perspectivas para responder con calma.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/80 p-4"
      >
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-gray-800">
            Conversacion
          </label>
          <textarea
            value={conversationText}
            onChange={(event) => setConversationText(event.target.value)}
            placeholder={"Persona A: ...\nPersona B: ..."}
            rows={6}
            className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-gray-800">
            Contexto opcional
          </label>
          <input
            type="text"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Ej: conflicto familiar, quiero responder con firmeza sin escalar"
            className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/25"
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading || conversationText.trim().length === 0}
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Analizando..." : "Analizar conversacion"}
        </button>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {result && (
        <section className="space-y-3">
          <article className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Analisis general
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-800">{result.analysis}</p>
          </article>

          <div className="space-y-2">
            {SYSTEM_ADVISORS.map((advisor: SystemAdvisor) => {
              const advisorResult = resultsByAdvisorId.get(advisor.id);
              const perspective = getPerspectiveContent(advisorResult);
              const isExpanded = expandedAdvisorId === advisor.id;
              const role = ROLE_BY_ADVISOR[advisor.id] ?? "Perspectiva";

              return (
                <article
                  key={advisor.id}
                  className="rounded-2xl border border-gray-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleAdvisor(advisor.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                    title={advisor.description}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Image
                        src={advisor.image}
                        alt={advisor.name}
                        width={44}
                        height={44}
                        className="rounded-lg border border-gray-200 bg-gray-100"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {advisor.name}
                        </p>
                        <p className="truncate text-xs text-gray-600">{role}</p>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-gray-600">
                      {isExpanded ? "Ocultar" : "Ver"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                      <p className="text-xs text-gray-600">{advisor.description}</p>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Reflexion
                        </p>
                        <p className="mt-1 text-sm leading-6 text-gray-800">
                          {perspective.reflection ??
                            "Podria haber varias interpretaciones; quizas conviene responder con prudencia."}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Respuesta sugerida
                        </p>
                        <p className="mt-1 text-sm leading-6 text-gray-900">
                          {perspective.suggestedReply ??
                            "Una opcion podria ser pausar y responder de forma clara y respetuosa."}
                        </p>
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyReply(advisor.id, perspective.suggestedReply)
                          }
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
                        >
                          {copiedAdvisorId === advisor.id ? "Copiado" : "Copiar respuesta"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
