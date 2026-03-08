"use client";

import { FormEvent, useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ChatResponse = {
  conversation_id: string;
  answer: string;
};

const API_URL = "http://localhost:8000/v1/chat";

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setError(null);
    setInput("");
    setLoading(true);

    const userMessage: Message = {
      id: `${Date.now()}-user`,
      role: "user",
      text: message,
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch(API_URL, {
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

      const assistantMessage: Message = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        text: data.answer,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setError("No se pudo enviar el mensaje. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Chat</h1>

      <section className="flex-1 rounded border border-gray-200 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no hay mensajes.</p>
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
          placeholder="Escribí un mensaje..."
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
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
