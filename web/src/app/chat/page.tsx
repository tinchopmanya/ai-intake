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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const CHAT_URL = `${API_BASE_URL}/v1/chat`;
const STORAGE_KEY = "conversation_id";
const DEFAULT_ASSISTANT_PROFILE = "general";

function mapHistoryToMessages(history: HistoryMessage[]): Message[] {
  return history.map((item, index) => ({
    id: `${index}-${item.role}`,
    role: item.role,
    text: item.message,
  }));
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNewConversation() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  async function loadConversationHistory(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/v1/conversations/${id}`, {
      cache: "no-store",
    });

    if (response.status === 404) {
      setMessages([]);
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: HistoryResponse = await response.json();
    setMessages(mapHistoryToMessages(data.messages));
  }

  useEffect(() => {
    const storedConversationId = window.localStorage.getItem(STORAGE_KEY);
    if (storedConversationId) {
      setConversationId(storedConversationId);
    }
  }, []);

  useEffect(() => {
    if (!conversationId) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, conversationId);

    let cancelled = false;

    async function syncHistory() {
      try {
        setError(null);
        const response = await fetch(
          `${API_BASE_URL}/v1/conversations/${conversationId}`,
          { cache: "no-store" },
        );

        if (response.status === 404) {
          if (!cancelled) {
            setMessages([]);
          }
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: HistoryResponse = await response.json();
        if (!cancelled) {
          setMessages(mapHistoryToMessages(data.messages));
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
          assistant_profile: DEFAULT_ASSISTANT_PROFILE,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: ChatResponse = await response.json();
      setConversationId(data.conversation_id);
      await loadConversationHistory(data.conversation_id);
    } catch {
      setError("No se pudo enviar el mensaje. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Chat</h1>
        <button
          type="button"
          onClick={handleNewConversation}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          Nueva conversacion
        </button>
      </div>

      <section className="flex-1 rounded border border-gray-200 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500">Todavia no hay mensajes.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((message) => (
              <li key={message.id} className="text-sm">
                <span className="font-semibold">
                  {message.role === "user" ? "Vos" : "Bot"}:
                </span>{" "}
                <span>{message.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading && <p className="text-sm text-gray-500">Enviando...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Escribi un mensaje..."
          className="flex-1 rounded border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-600 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || input.trim().length === 0}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Enviar
        </button>
      </form>
    </main>
  );
}
