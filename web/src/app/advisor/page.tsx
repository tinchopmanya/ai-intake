"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  ADVISOR_NOTICE,
  ADVISOR_PROFILES,
  advisorProfileById,
} from "@/data/advisors";

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
  const [profileModalAdvisorId, setProfileModalAdvisorId] = useState<string | null>(null);

  const resultsByAdvisorId = useMemo(() => {
    const map = new Map<string, AdvisorResult>();
    for (const item of result?.results ?? []) {
      map.set(item.advisor_id, item);
    }
    return map;
  }, [result]);

  const selectedProfile = profileModalAdvisorId
    ? advisorProfileById[profileModalAdvisorId]
    : null;

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileModalAdvisorId(null);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-5 md:p-6">
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">
            Tus consejeros estan listos para responder
          </h2>
          <div className="space-y-4">
            {ADVISOR_PROFILES.map((advisor) => (
              <article
                key={advisor.id}
                className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <Image
                    src={advisor.avatar128}
                    alt={advisor.name}
                    width={96}
                    height={96}
                    className="h-24 w-24 rounded-xl border border-gray-200 object-cover"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{advisor.name}</p>
                    <p className="text-xs text-gray-600">{advisor.role}</p>
                    <p className="mt-1 text-xs text-gray-500">{advisor.age} anos</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          <header className="rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4">
            <h1 className="text-2xl font-bold text-slate-100">Consejero de conversaciones</h1>
            <p className="mt-1 text-sm text-slate-300">
              Pega una conversacion dificil y revisa tres perspectivas antes de responder.
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
                rows={5}
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
                {ADVISOR_PROFILES.map((advisor) => {
                  const advisorResult = resultsByAdvisorId.get(advisor.id);
                  const perspective = getPerspectiveContent(advisorResult);
                  const isExpanded = expandedAdvisorId === advisor.id;

                  return (
                    <article
                      key={advisor.id}
                      className="rounded-2xl border border-gray-200 bg-white shadow-sm"
                    >
                      <div
                        onClick={() => toggleAdvisor(advisor.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left"
                        title={advisor.description}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setProfileModalAdvisorId(advisor.id);
                            }}
                            className="shrink-0"
                            aria-label={`Abrir perfil de ${advisor.name}`}
                          >
                            <Image
                              src={advisor.avatar64}
                              alt={advisor.name}
                              width={64}
                              height={64}
                              className="h-16 w-16 rounded-lg border border-gray-200 object-cover"
                            />
                          </button>
                          <div className="min-w-0 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setProfileModalAdvisorId(advisor.id);
                              }}
                              className="truncate text-sm font-semibold text-gray-900 hover:underline"
                            >
                              {advisor.name}
                            </button>
                            <span className="text-xs text-gray-400">•</span>
                            <p className="truncate text-xs text-gray-600">{advisor.role}</p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-gray-600" aria-hidden="true">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="space-y-2.5 border-t border-gray-100 px-4 py-3">
                          <p className="text-xs text-gray-600">{advisor.description}</p>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Reflexion
                            </p>
                            <p className="mt-1 text-sm leading-5 text-gray-800">
                              {perspective.reflection ??
                                "Podria haber varias interpretaciones; quizas conviene responder con prudencia."}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Respuesta sugerida
                            </p>
                            <p className="mt-1 text-sm leading-5 text-gray-900">
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
                              {copiedAdvisorId === advisor.id
                                ? "Copiado"
                                : "Copiar respuesta"}
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
        </section>
      </div>

      {selectedProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setProfileModalAdvisorId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-900">Perfil del consejero</h3>
              <button
                type="button"
                onClick={() => setProfileModalAdvisorId(null)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center text-center">
              <Image
                src={selectedProfile.avatar256}
                alt={selectedProfile.name}
                width={256}
                height={256}
                className="h-48 w-48 rounded-2xl border border-gray-200 object-cover md:h-56 md:w-56"
              />
              <p className="mt-3 text-lg font-semibold text-gray-900">{selectedProfile.name}</p>
              <p className="text-sm text-gray-600">{selectedProfile.age} anos</p>
              <p className="mt-1 text-sm font-medium text-gray-700">{selectedProfile.role}</p>
              <p className="mt-3 text-sm leading-6 text-gray-700">
                {selectedProfile.description}
              </p>
              <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
                {ADVISOR_NOTICE}
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
