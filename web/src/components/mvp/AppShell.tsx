"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { advisorFloatingPanelClass } from "@/components/mvp/advisorUiStyles";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { postAdvisorChat } from "@/lib/api/client";
import { getCurrentUser, logoutSession } from "@/lib/auth/client";

type AppShellProps = {
  children: ReactNode;
};

function getAdvisorAvatar(
  advisor: (typeof ADVISOR_PROFILES)[number] | undefined,
  variant: "64" | "128",
) {
  if (!advisor) return null;
  if (variant === "64") return advisor.avatar64 ?? advisor.avatar128 ?? null;
  return advisor.avatar128 ?? advisor.avatar64 ?? null;
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const advisorDropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [advisorMenuOpen, setAdvisorMenuOpen] = useState(false);
  const [displayName, setDisplayName] = useState("Usuario");
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatDebugPayload, setAdvisorChatDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);
  const speechSynthesis = useSpeechSynthesis({ lang: "es-ES" });

  useEffect(() => {
    let mounted = true;
    void getCurrentUser().then((user) => {
      if (!mounted || !user) return;
      const resolvedName = (user.name || user.email || "Usuario").trim();
      setDisplayName(resolvedName || "Usuario");
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!dropdownRef.current) return;
      const target = event.target as Node | null;
      if (target && !dropdownRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (target && advisorDropdownRef.current && !advisorDropdownRef.current.contains(target)) {
        setAdvisorMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onDocumentClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDocumentClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const initials = useMemo(() => {
    const parts = displayName
      .split(" ")
      .filter((part) => part.trim().length > 0)
      .slice(0, 2);
    if (parts.length === 0) return "U";
    return parts.map((part) => part[0]!.toUpperCase()).join("");
  }, [displayName]);

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  function handleSelectAdvisor(index: number) {
    setAdvisorMenuOpen(false);
    setAdvisorChatIndex(index);
    setAdvisorChatInput("");
    setAdvisorChatDebugPayload(null);
    setAdvisorChatMessages([]);
    setAdvisorChatOpen(true);
  }

  async function handleSendAdvisorMessage() {
    if (advisorChatIndex === null || advisorChatSending || !advisorChatInput.trim()) return;
    const userInput = advisorChatInput.trim();
    const advisor = ADVISOR_PROFILES[advisorChatIndex];
    const outboundMessages = [
      ...advisorChatMessages.map((item) => ({
        role: item.role,
        content: item.text,
      })),
      {
        role: "user" as const,
        content: userInput,
      },
    ];
    const advisorPayload = {
      advisor_id: advisor?.id ?? "laura",
      entry_mode: "advisor_conversation" as const,
      messages: outboundMessages,
      conversation_context: {
        user_name: displayName,
      },
      debug: process.env.NODE_ENV !== "production",
    };
    if (process.env.NODE_ENV !== "production") {
      const debugPayload = {
        endpoint: "/v1/advisor/chat",
        entryMode: "advisor_conversation",
        advisor: advisor
          ? {
              id: advisor.id,
              name: advisor.name,
              role: advisor.role,
            }
          : null,
        userInput,
        payload: advisorPayload,
      };
      setAdvisorChatDebugPayload(debugPayload);
      console.debug("advisor_prompt_debug", debugPayload);
    }
    setAdvisorChatSending(true);
    try {
      const result = await postAdvisorChat(advisorPayload);
      const reply = result.message || "No se pudo generar una respuesta en este momento.";
      setAdvisorChatMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: userInput },
        { id: `a-${Date.now() + 1}`, role: "advisor", text: reply },
      ]);
      if (speechSynthesis.supported && reply.trim()) {
        speechSynthesis.speak(reply);
      }
      setAdvisorChatInput("");
      if (process.env.NODE_ENV !== "production") {
        setAdvisorChatDebugPayload((previous) => ({
          ...(previous ?? {}),
          response: result,
          response_preview: reply.slice(0, 500),
        }));
      }
    } catch {
      setAdvisorChatMessages((prev) => [
        ...prev,
        {
          id: `a-err-${Date.now()}`,
          role: "advisor",
          text: "No pude responder ahora. Intenta nuevamente.",
        },
      ]);
    } finally {
      setAdvisorChatSending(false);
    }
  }

  function handleVoiceAdvisorSessionSync(payload: {
    turns: Array<{ role: "user" | "advisor"; text: string }>;
    lastSuggestedReply: string | null;
    debug?: Record<string, unknown> | null;
  }) {
    if (payload.turns.length === 0) return;
    const newTurns = payload.turns.map((turn, index) => ({
      id: `v-sync-${Date.now()}-${index}`,
      role: turn.role,
      text: turn.text,
    }));
    setAdvisorChatMessages((prev) => [...prev, ...newTurns]);
    const latestAdvisorText =
      [...payload.turns].reverse().find((turn) => turn.role === "advisor")?.text ?? "";
    if (speechSynthesis.supported && latestAdvisorText.trim()) {
      speechSynthesis.speak(latestAdvisorText);
    }
    if (process.env.NODE_ENV !== "production") {
      setAdvisorChatDebugPayload((previous) => ({
        ...(previous ?? {}),
        voice_response: payload,
        endpoint: "/v1/advisor/voice",
      }));
    }
  }

  return (
    <main className="mx-auto flex h-screen w-full max-w-[980px] min-w-0 flex-col overflow-x-hidden bg-white px-4 pb-4 pt-3 sm:px-6">
      <header className="mx-auto flex w-full items-center justify-between border-b border-[#eee] py-3">
        <h1 className="text-[20px] font-semibold text-[#111]">Consejero de Conversaciones</h1>
        <div className="flex items-center gap-2">
          <div ref={advisorDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setAdvisorMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={advisorMenuOpen}
              className="h-9 rounded-full border border-[#cad5e2] bg-white px-3.5 text-[13px] font-medium text-[#1f2937] shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition-all hover:border-[#b6c4d5] hover:bg-[#f8fbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(51,65,85,0.18)]"
            >
              Hablar con un advisor
            </button>
            {advisorMenuOpen ? (
              <div role="menu" className={`absolute right-0 z-20 mt-2 w-[340px] ${advisorFloatingPanelClass}`}>
                <ul className="space-y-2 p-2.5">
                  {ADVISOR_PROFILES.map((advisor, index) => {
                    const dropdownAvatarSrc = getAdvisorAvatar(advisor, "64");
                    const advisorInitials = advisor.name
                      .split(" ")
                      .filter((part) => part.trim().length > 0)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() ?? "")
                      .join("");
                    return (
                      <li key={advisor.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleSelectAdvisor(index)}
                        className="flex w-full items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-left transition-all hover:border-white/16 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      >
                        {dropdownAvatarSrc ? (
                          <Image
                            src={dropdownAvatarSrc}
                            alt={advisor.name}
                            width={44}
                            height={44}
                            className="h-11 w-11 rounded-2xl border border-white/14 object-cover shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
                          />
                        ) : (
                          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/14 bg-[#2d3f6b] text-[12px] font-semibold text-white">
                            {advisorInitials || "AD"}
                          </span>
                        )}
                        <div className="min-w-0 flex-1 pt-0.5">
                          <p className="text-[13px] font-semibold text-white">{advisor.name}</p>
                          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-200/78">
                            {advisor.description}
                          </p>
                        </div>
                      </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-9 items-center gap-2 rounded-full border border-[#ddd] bg-white px-3 text-[13px] font-medium text-[#111] transition-colors hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(17,17,17,0.2)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111] text-xs font-bold text-white">
                {initials}
              </span>
              <span className="max-w-[110px] truncate">{displayName}</span>
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-[#e5e5e5] bg-white p-1 shadow-[0_8px_18px_rgba(15,23,42,0.08)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/onboarding?edit=1");
                  }}
                  role="menuitem"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#111] transition-colors hover:bg-[#fafafa]"
                >
                  Editar mis datos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleLogout();
                  }}
                  role="menuitem"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#B91C1C] transition-colors hover:bg-[#FEF2F2]"
                >
                  Cerrar sesión
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <section className="mx-auto mt-3 flex min-h-0 w-full min-w-0 flex-1">{children}</section>
      <AdvisorChatModal
        isOpen={advisorChatOpen}
        advisorId={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.id : undefined}
        advisorName={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.name ?? "Adviser" : "Adviser"}
        advisorRole={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.role ?? "" : ""}
        advisorDescription={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.description ?? "" : ""}
        userName={displayName}
        advisorAvatarSrc={
          advisorChatIndex !== null
            ? getAdvisorAvatar(ADVISOR_PROFILES[advisorChatIndex], "128")
            : null
        }
        messages={advisorChatMessages}
        draft={advisorChatInput}
        sending={advisorChatSending}
        entryMode="advisor_conversation"
        onDraftChange={setAdvisorChatInput}
        onSend={() => void handleSendAdvisorMessage()}
        onUseResponse={() => setAdvisorChatOpen(false)}
        onClose={() => setAdvisorChatOpen(false)}
        helperCopy={`Como estas hoy, ${displayName}? En que te puedo ayudar?`}
        debugPayload={advisorChatDebugPayload}
        autoSendOnVoiceComplete
        onVoiceSessionSync={handleVoiceAdvisorSessionSync}
      />
    </main>
  );
}

