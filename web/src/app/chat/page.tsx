"use client";

import { FormEvent, useEffect, useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ChatResponse = {
  conversation_id: string;
  answer: string;
};

type HistoryMessage = {
  role: "user" | "assistant";
  message: string;
  channel: string;
};

type HistoryResponse = {
  conversation_id: string;
  messages: HistoryMessage[];
};

type ConversationItem = {
  id: string;
  title: string;
  updatedAt: number;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const CHAT_URL = `${API_BASE_URL}/v1/chat`;
const ACTIVE_CONVERSATION_STORAGE_KEY = "conversation_id";
const CONVERSATIONS_STORAGE_KEY = "conversation_list";
const MAX_CONVERSATIONS = 30;

function mapHistoryToMessages(history: HistoryMessage[]): Message[] {
  return history.map((item, index) => ({
    id: `${index}-${item.role}`,
    role: item.role,
    text: item.message,
  }));
}

function truncateTitle(text: string, maxLength = 36): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function readConversationList(): ConversationItem[] {
  const raw = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ConversationItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.updatedAt === "number",
    );
  } catch {
    return [];
  }
}

function upsertConversation(
  list: ConversationItem[],
  id: string,
  title: string,
): ConversationItem[] {
  const next = [
    { id, title: truncateTitle(title.trim() || "Nueva conversacion"), updatedAt: Date.now() },
    ...list.filter((item) => item.id !== id),
  ];
  return next.slice(0, MAX_CONVERSATIONS);
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationList, setConversationList] = useState<ConversationItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNewConversation() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
  }

  async function fetchConversationHistory(id: string): Promise<HistoryResponse | null> {
    const response = await fetch(`${API_BASE_URL}/v1/conversations/${id}`, {
      cache: "no-store",
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as HistoryResponse;
  }

  function handleSelectConversation(id: string) {
    setError(null);
    setConversationId(id);
  }

  useEffect(() => {
    setConversationList(readConversationList());
    const storedConversationId = window.localStorage.getItem(
      ACTIVE_CONVERSATION_STORAGE_KEY,
    );
    if (storedConversationId) {
      setConversationId(storedConversationId);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(conversationList),
    );
  }, [conversationList]);

  useEffect(() => {
    if (!conversationId) {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);

    let cancelled = false;

    async function syncHistory() {
      try {
        setError(null);
        const data = await fetchConversationHistory(conversationId);
        if (!data) {
          if (!cancelled) {
            setConversationList((prev) =>
              prev.filter((item) => item.id !== conversationId),
            );
            setConversationId(null);
            setMessages([]);
            window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
            setError("La conversacion guardada ya no existe. Inicia una nueva.");
          }
          return;
        }

        if (!cancelled) {
          setMessages(mapHistoryToMessages(data.messages));
          const firstUserMessage = data.messages.find((msg) => msg.role === "user");
          const fallbackTitle = `Conversacion ${conversationId.slice(0, 8)}`;
          setConversationList((prev) =>
            upsertConversation(prev, conversationId, firstUserMessage?.message ?? fallbackTitle),
          );
        }
      } catch {
        if (!cancelled) {
          setError("No se pudo cargar el historial.");
        }
      }
    }

    syncHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setError(null);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId ?? null,
          message,
          channel: "web",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: ChatResponse = await response.json();
      setConversationId(data.conversation_id);
      setConversationList((prev) =>
        upsertConversation(prev, data.conversation_id, message),
      );
    } catch {
      setError("No se pudo enviar el mensaje. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col p-4 sm:p-6">
      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-700">Conversaciones</h2>
            <button
              type="button"
              onClick={handleNewConversation}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Nueva
            </button>
          </div>
          <ul className="space-y-1">
            {conversationList.length === 0 ? (
              <li className="rounded-md px-2 py-2 text-xs text-zinc-500">
                No hay conversaciones guardadas.
              </li>
            ) : (
              conversationList.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectConversation(conversation.id)}
                    className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                      conversation.id === conversationId
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-700 hover:bg-zinc-200"
                    }`}
                    title={conversation.title}
                  >
                    {conversation.title}
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className="flex min-h-[70vh] flex-col rounded-2xl border border-zinc-200 bg-white">
          <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h1 className="text-base font-semibold text-zinc-900">Chat</h1>
            <span className="text-xs text-zinc-500">
              {conversationId ? `ID: ${conversationId.slice(0, 8)}...` : "Nueva conversacion"}
            </span>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavia no hay mensajes.</p>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    message.role === "user"
                      ? "ml-auto bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-900"
                  }`}
                >
                  {message.text}
                </article>
              ))
            )}
          </div>

          <div className="border-t border-zinc-200 px-4 py-3">
            {loading && <p className="mb-2 text-xs text-zinc-500">Enviando...</p>}
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Escribi un mensaje..."
                className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || input.trim().length === 0}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Enviar
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
