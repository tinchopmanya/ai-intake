"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { MvpShellContextProvider } from "@/components/mvp/MvpShellContext";
import type { SidebarConversationSummary } from "@/components/mvp/MvpShellContext";
import styles from "@/components/mvp/MvpShell.module.css";
import { ADVISOR_PROFILES } from "@/data/advisors";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { getConversations, postConversation } from "@/lib/api/client";
import { postAdvisorChat } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
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

function mapConversationSummary(
  conversation: Awaited<ReturnType<typeof postConversation>>,
): SidebarConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    titleStatus: conversation.title_status,
    advisorId: conversation.advisor_id,
    startedAt: conversation.created_at,
    lastMessageAt: conversation.last_message_at,
  };
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const advisorDropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [advisorMenuOpen, setAdvisorMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [displayName, setDisplayName] = useState("Usuario");
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatDebugPayload, setAdvisorChatDebugPayload] = useState<Record<string, unknown> | null>(null);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<
    Array<{ id: string; role: "user" | "advisor"; text: string }>
  >([]);
  const [conversations, setConversations] = useState<SidebarConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
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
    let mounted = true;
    void getConversations()
      .then((response) => {
        if (!mounted) return;
        setConversations(response.conversations.map(mapConversationSummary));
      })
      .catch(() => {
        if (!mounted) return;
        setConversations([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = (matches: boolean) => {
      setIsDesktop(matches);
      setSidebarOpen(matches);
    };
    sync(media.matches);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (target && advisorDropdownRef.current && !advisorDropdownRef.current.contains(target)) {
        setAdvisorMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setAdvisorMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", onDocumentClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDocumentClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const sidebarConversation = activeConversation ?? conversations[0] ?? null;

  const initials = useMemo(() => {
    const parts = displayName
      .split(" ")
      .filter((part) => part.trim().length > 0)
      .slice(0, 2);
    if (parts.length === 0) return "U";
    return parts.map((part) => part[0]!.toUpperCase()).join("");
  }, [displayName]);

  const createSidebarConversation = useCallback(
    async (options?: { advisorId?: string | null }) => {
      try {
        const created = mapConversationSummary(
          await postConversation({
            advisor_id: options?.advisorId ?? undefined,
          }),
        );
        setConversations((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
        setActiveConversationId(created.id);
        return created;
      } catch (error) {
        console.error("sidebar_conversation_create_failed", error);
        return null;
      }
    },
    [],
  );

  const updateSidebarConversation = useCallback((conversation: SidebarConversationSummary) => {
    setConversations((previous) =>
      previous.map((item) => (item.id === conversation.id ? { ...item, ...conversation } : item)),
    );
  }, []);

  const ensureActiveConversation = useCallback(
    async (options?: { advisorId?: string | null }) => {
      if (activeConversation) return activeConversation;
      return createSidebarConversation(options);
    },
    [activeConversation, createSidebarConversation],
  );

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

  function openAdvisorConversation(advisorId: string) {
    const advisorIndex = ADVISOR_PROFILES.findIndex((advisor) => advisor.id === advisorId);
    handleSelectAdvisor(advisorIndex >= 0 ? advisorIndex : 0);
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
    } catch (error) {
      const reply = toUiErrorMessage(error, "No pude responder ahora. Intenta nuevamente.");
      setAdvisorChatMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: userInput },
        {
          id: `a-err-${Date.now()}`,
          role: "advisor",
          text: reply,
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
    <MvpShellContextProvider
      value={{
        displayName,
        initials,
        sidebarConversation,
        activeConversation,
        ensureActiveConversation,
        createSidebarConversation,
        updateSidebarConversation,
        setActiveConversationId,
        openAdvisorConversation,
      }}
    >
      <main className={styles.shellRoot}>
      <header className={styles.shellTopbar}>
        <div className={styles.shellBrand}>
          <span className={styles.shellBrandAccent} aria-hidden="true" />
          <span>ExReply</span>
        </div>
        <div className={styles.shellActions}>
          <div ref={advisorDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setAdvisorMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={advisorMenuOpen}
              className={styles.shellAdvisorTrigger}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className={styles.shellAdvisorTriggerIcon} fill="none">
                <path
                  d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5v1.25A3.25 3.25 0 0 1 4 12v.5h12V12a3.25 3.25 0 0 1-1.5-2.75V8A4.5 4.5 0 0 0 10 3.5Zm0 12.75a2.2 2.2 0 0 0 2.02-1.33H7.98A2.2 2.2 0 0 0 10 16.25Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.4"
                />
              </svg>
              Hablar con un advisor
            </button>
            {advisorMenuOpen ? (
              <div role="menu" className={`absolute right-0 z-20 mt-2 w-[340px] ${styles.shellDropdownPanel}`}>
                <ul className={styles.shellAdvisorList}>
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
                          className={styles.shellAdvisorItem}
                        >
                          {dropdownAvatarSrc ? (
                            <Image
                              src={dropdownAvatarSrc}
                              alt={advisor.name}
                              width={42}
                              height={42}
                              className={styles.shellAdvisorAvatar}
                            />
                          ) : (
                            <span className={styles.shellAdvisorFallback}>{advisorInitials || "AD"}</span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={styles.shellAdvisorName}>{advisor.name}</p>
                            <p className={styles.shellAdvisorDescription}>{advisor.description}</p>
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
              className={styles.shellUserButton}
              title={displayName}
              aria-label={displayName}
            >
              {initials}
            </button>
            {menuOpen ? (
              <div role="menu" className={`absolute right-0 z-20 mt-2 ${styles.shellUserMenu}`}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/onboarding?edit=1");
                  }}
                  role="menuitem"
                  className={styles.shellUserMenuItem}
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
                  className={styles.shellUserMenuItem}
                >
                  Cerrar sesion
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className={styles.shellWorkspace}>
        {!isDesktop && sidebarOpen ? (
          <button
            type="button"
            aria-label="Cerrar sidebar"
            className={styles.shellMobileBackdrop}
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <aside
          className={`${styles.shellSidebar} ${sidebarOpen ? styles.shellSidebarExpanded : ""}`}
          aria-label="Conversaciones"
        >
          <div className={styles.shellSidebarHeader}>
            {sidebarOpen ? <span className={styles.shellSidebarTitle}>Conversaciones</span> : <span />}
            <button
              type="button"
              className={styles.shellSidebarToggle}
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label={sidebarOpen ? "Colapsar sidebar" : "Expandir sidebar"}
              aria-expanded={sidebarOpen}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={`${styles.shellSidebarChevron} ${sidebarOpen ? styles.shellSidebarChevronOpen : ""}`}
                fill="none"
              >
                <path
                  d="m7 4 6 6-6 6"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>

          {sidebarOpen ? (
            <>
              <div className={styles.shellSidebarPrimaryAction}>
                <button
                  type="button"
                  className={styles.shellNewConversation}
                  onClick={() => {
                    void createSidebarConversation().then((created) => {
                      if (!created) return;
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new Event("mvp:new-conversation"));
                      }
                      if (!isDesktop) setSidebarOpen(false);
                    });
                  }}
                >
                  <span className={styles.shellNewConversationIcon} aria-hidden="true">
                    +
                  </span>
                  Nueva conversacion
                </button>
              </div>
              <div className={styles.shellSidebarBody}>
                {conversations.length > 0 ? (
                  <div className={styles.shellSessionList}>
                    {conversations.map((conversation) => {
                      const isActive = conversation.id === activeConversationId;
                      const parsedDate = new Date(conversation.lastMessageAt);
                      const metaLabel = Number.isNaN(parsedDate.getTime())
                        ? ""
                        : new Intl.DateTimeFormat("es-UY", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(parsedDate);
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          className={`${styles.shellSessionItem} ${isActive ? styles.shellSessionActive : ""}`}
                          onClick={() => setActiveConversationId(conversation.id)}
                        >
                          <p className={styles.shellSessionTitle}>{conversation.title}</p>
                          <p className={styles.shellSessionMeta}>{metaLabel}</p>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className={styles.shellSidebarRail} />
          )}
        </aside>

        <section className={styles.shellContent}>{children}</section>
      </div>

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
    </MvpShellContextProvider>
  );
}
