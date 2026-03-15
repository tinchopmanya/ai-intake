"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { Panel } from "@/components/mvp/ui";
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
    <main className="mx-auto flex min-h-screen w-full max-w-[1080px] min-w-0 flex-col gap-4 overflow-x-hidden bg-[#F8FAFC] px-4 py-5 sm:px-5 sm:py-6">
      <Panel className="mx-auto flex w-full items-center justify-between border-[#E2E8F0] bg-white px-4 py-3">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Consejero de Conversaciones</h1>
          <p className="mt-1 text-sm text-[#475569]">
            Pega una conversacion dificil y revisa tres perspectivas antes de responder.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-[#334155] underline underline-offset-2">
            Inicio
          </Link>
          <div ref={advisorDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setAdvisorMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={advisorMenuOpen}
              className="h-10 rounded-full border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-[#F1F5F9] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(37,99,235,0.22)]"
            >
              Hablar con un adviser
            </button>
            {advisorMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-[320px] rounded-xl border border-[#E2E8F0] bg-white p-2 shadow-[0_10px_30px_rgba(15,23,42,0.16)]"
              >
                <ul className="space-y-1">
                  {ADVISOR_PROFILES.map((advisor, index) => (
                    <li key={advisor.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleSelectAdvisor(index)}
                        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[#F1F5F9]"
                      >
                        <Image
                          src={advisor.avatar128}
                          alt={advisor.name}
                          width={40}
                          height={40}
                          className="h-10 w-10 rounded-full border border-[#E2E8F0] object-cover"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#0F172A]">{advisor.name}</p>
                          <p className="line-clamp-2 text-xs text-[#475569]">{advisor.description}</p>
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
              className="flex h-10 items-center gap-2 rounded-full border border-[#CBD5E1] bg-white px-3 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-[#F1F5F9] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(37,99,235,0.22)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white">
                {initials}
              </span>
              <span className="max-w-[110px] truncate">{displayName}</span>
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-[#E2E8F0] bg-white p-1 shadow-[0_10px_30px_rgba(15,23,42,0.16)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/onboarding?edit=1");
                  }}
                  role="menuitem"
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#0F172A] transition-colors hover:bg-[#F1F5F9]"
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
      </Panel>
      <section className="mx-auto w-full min-w-0">{children}</section>
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
      />
    </main>
  );
}
