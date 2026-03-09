"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";

import AdvisorSelector from "@/components/advisor/AdvisorSelector";
import { systemAdvisorById } from "@/components/advisor/systemAdvisors";

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

type AdvisorHistoryResponse = {
  conversation_id: string;
  analysis: string | null;
  results: AdvisorResult[];
};

type AdvisorConversationSummary = {
  conversation_id: string;
  contact_id: string | null;
  created_at: string;
  updated_at: string;
  analysis_preview: string | null;
  advisors_count: number;
};

type AdvisorConversationListResponse = {
  conversations: AdvisorConversationSummary[];
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const ADVISOR_URL = `${API_BASE_URL}/v1/advisor`;
const ADVISOR_CONVERSATIONS_URL = `${API_BASE_URL}/v1/advisor/conversations`;
const STORAGE_KEY = "advisor_conversation_id";

function getAdvisorVisual(advisor: AdvisorResult) {
  const profile = systemAdvisorById[advisor.advisor_id];
  if (profile) {
    return profile;
  }
  return {
    id: advisor.advisor_id,
    name: advisor.advisor_name,
    role: "Consejero",
    description: "Perfil sin metadata visual cargada.",
    image: "/advisors/generic.svg",
  };
}

function formatSessionTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Fecha desconocida";
  }
  return new Intl.DateTimeFormat("es-UY", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function AdvisorPage() {
  const [conversationText, setConversationText] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const [copiedSuggestionKey, setCopiedSuggestionKey] = useState<string | null>(null);
  const [selectedAdvisors, setSelectedAdvisors] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AdvisorConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);

  const loadConversations = useCallback(
    async (
      preferredConversationId?: string | null,
    ): Promise<AdvisorConversationSummary[]> => {
      const response = await fetch(ADVISOR_CONVERSATIONS_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as AdvisorConversationListResponse;
      setConversations(payload.conversations);

      const target = preferredConversationId ?? null;
      if (target) {
        const exists = payload.conversations.some(
          (conversation) => conversation.conversation_id === target,
        );
        if (!exists) {
          setConversationId(null);
          setResult(null);
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }

      return payload.conversations;
    },
    [],
  );

  const loadConversationHistory = useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`${ADVISOR_CONVERSATIONS_URL}/${id}`, {
      cache: "no-store",
    });

    if (response.status === 404) {
      setConversations((current) =>
        current.filter((conversation) => conversation.conversation_id !== id),
      );
      setConversationId(null);
      setResult(null);
      window.localStorage.removeItem(STORAGE_KEY);
      throw new Error("NOT_FOUND");
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const history = (await response.json()) as AdvisorHistoryResponse;
    setResult({
      conversation_id: history.conversation_id,
      analysis: history.analysis ?? "Sin analisis disponible.",
      results: history.results,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const storedConversationId = window.localStorage.getItem(STORAGE_KEY);

      try {
        setLoadingConversations(true);
        const loaded = await loadConversations(storedConversationId);
        if (cancelled) {
          return;
        }

        const initialConversationId =
          storedConversationId &&
          loaded.some((conversation) => conversation.conversation_id === storedConversationId)
            ? storedConversationId
            : loaded[0]?.conversation_id ?? null;

        if (!initialConversationId) {
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }

        setConversationId(initialConversationId);
        window.localStorage.setItem(STORAGE_KEY, initialConversationId);
        await loadConversationHistory(initialConversationId);
      } catch {
        if (!cancelled) {
          setError("No se pudo cargar el historial de sesiones.");
        }
      } finally {
        if (!cancelled) {
          setLoadingConversations(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [loadConversationHistory, loadConversations]);

  async function handleSelectConversation(id: string) {
    if (id === conversationId) {
      return;
    }

    setError(null);
    setCopiedSuggestionKey(null);
    setConversationId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
    try {
      await loadConversationHistory(id);
    } catch (selectionError) {
      if (selectionError instanceof Error && selectionError.message === "NOT_FOUND") {
        setError("La sesion seleccionada ya no existe.");
      } else {
        setError("No se pudo cargar la sesion seleccionada.");
      }
    }
  }

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
          conversation_id: conversationId,
          conversation_text: text,
          context: context.trim(),
          selected_advisors: selectedAdvisors,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdvisorResponse;
      setResult(data);
      setConversationId(data.conversation_id);
      window.localStorage.setItem(STORAGE_KEY, data.conversation_id);
      await loadConversations(data.conversation_id);
      setConversationText("");
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

  const handleAdvisorSelectionChange = useCallback((selected: string[]) => {
    setSelectedAdvisors(selected);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 p-6">
      <header className="rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5">
        <h1 className="text-2xl font-bold text-slate-100">Consejero de conversaciones</h1>
        <p className="mt-1 text-sm text-slate-300">
          Pega una conversacion y recibe sugerencias claras desde distintos perfiles.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
            Sesiones
          </h2>
          {loadingConversations ? (
            <p className="mt-3 text-sm text-gray-500">Cargando sesiones...</p>
          ) : conversations.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Aun no hay sesiones. Genera tu primer analisis.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {conversations.map((conversation) => {
                const active = conversation.conversation_id === conversationId;
                return (
                  <li key={conversation.conversation_id}>
                    <button
                      type="button"
                      onClick={() => handleSelectConversation(conversation.conversation_id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left ${
                        active
                          ? "border-gray-900 bg-gray-100"
                          : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                        Sesion {conversation.conversation_id.slice(0, 8)}
                      </p>
                      <p className="mt-1 text-xs text-gray-600">
                        {formatSessionTimestamp(conversation.updated_at)}
                      </p>
                      {conversation.analysis_preview && (
                        <p className="mt-2 text-xs leading-5 text-gray-700">
                          {conversation.analysis_preview}
                        </p>
                      )}
                      <p className="mt-2 text-[11px] text-gray-500">
                        {conversation.advisors_count} consejero
                        {conversation.advisors_count === 1 ? "" : "s"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="space-y-4">
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/70 p-5"
          >
            <AdvisorSelector onSelectionChange={handleAdvisorSelectionChange} />

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
              {loading ? "Analizando..." : "Analizar conversacion"}
            </button>
          </form>

          {error && <p className="text-sm text-red-700">{error}</p>}

          {result ? (
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
                          src={profile.image}
                          alt={profile.name}
                          width={52}
                          height={52}
                          className="rounded-xl border border-gray-200 bg-gray-100"
                        />
                        <div>
                          <h3 className="text-base font-semibold text-gray-900">
                            {profile.name}
                          </h3>
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
          ) : (
            <article className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
              Selecciona una sesion o genera un analisis para ver resultados.
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
