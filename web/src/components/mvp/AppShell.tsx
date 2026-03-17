"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { postAdvisor } from "@/lib/api/client";
import { getCurrentUser, logoutSession } from "@/lib/auth/client";

type AppShellProps = {
  children: ReactNode;
};

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
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);

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
    setAdvisorChatMessages([]);
    setAdvisorChatOpen(true);
  }

  async function handleSendAdvisorMessage() {
    if (advisorChatIndex === null || advisorChatSending || !advisorChatInput.trim()) return;
    const instruction = advisorChatInput.trim();
    setAdvisorChatSending(true);
    try {
      const result = await postAdvisor({
        message_text: instruction,
        mode: "reactive",
        relationship_type: "otro",
        quick_mode: true,
        save_session: false,
        source_type: "text",
        context: {
          user_style: "cordial",
        },
      });
      const reply =
        result.responses[advisorChatIndex]?.text ??
        result.responses[0]?.text ??
        "No se pudo generar una respuesta en este momento.";
      setAdvisorChatMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: instruction },
        { id: `a-${Date.now() + 1}`, role: "advisor", text: reply },
      ]);
      setAdvisorChatInput("");
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
              className="h-9 rounded-[10px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111] transition-colors hover:border-[#d8d8d8] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(17,17,17,0.2)]"
            >
              Hablar con un advisor
            </button>
            {advisorMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-[320px] rounded-xl border border-[#e5e5e5] bg-white p-2 shadow-[0_8px_18px_rgba(15,23,42,0.08)]"
              >
                <ul className="space-y-1">
                  {ADVISOR_PROFILES.map((advisor, index) => (
                    <li key={advisor.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleSelectAdvisor(index)}
                        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[#fafafa]"
                      >
                        <Image
                          src={advisor.avatar128}
                          alt={advisor.name}
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded-full border border-[#e5e5e5] object-cover"
                        />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#111]">{advisor.name}</p>
                          <p className="line-clamp-2 text-[12px] text-[#666]">{advisor.description}</p>
                        </div>
                      </button>
                    </li>
                  ))}
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
        advisorName={advisorChatIndex !== null ? ADVISOR_PROFILES[advisorChatIndex]?.name ?? "Adviser" : "Adviser"}
        messages={advisorChatMessages}
        draft={advisorChatInput}
        sending={advisorChatSending}
        onDraftChange={setAdvisorChatInput}
        onSend={() => void handleSendAdvisorMessage()}
        onUseResponse={() => setAdvisorChatOpen(false)}
        onClose={() => setAdvisorChatOpen(false)}
        helperCopy={`¿Como estas hoy, ${displayName}? ¿En que te puedo ayudar?`}
      />
    </main>
  );
}
