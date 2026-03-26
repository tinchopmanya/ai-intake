"use client";

import { createContext, useContext } from "react";

import type { ConversationSummary } from "@/lib/api/types";

export type SidebarConversationSummary = {
  id: string;
  title: string;
  titleStatus: ConversationSummary["title_status"];
  advisorId: string | null;
  startedAt: string;
  lastMessageAt: string;
};

type MvpShellContextValue = {
  displayName: string;
  initials: string;
  sidebarConversation: SidebarConversationSummary | null;
  activeConversation: SidebarConversationSummary | null;
  ensureActiveConversation: (options?: { advisorId?: string | null }) => Promise<SidebarConversationSummary | null>;
  createSidebarConversation: (options?: { advisorId?: string | null }) => Promise<SidebarConversationSummary | null>;
  setActiveConversationId: (conversationId: string | null) => void;
  openAdvisorConversation: (advisorId: string) => void;
};

const MvpShellContext = createContext<MvpShellContextValue | null>(null);

export const MvpShellContextProvider = MvpShellContext.Provider;

export function useMvpShell() {
  const context = useContext(MvpShellContext);
  if (!context) {
    throw new Error("useMvpShell must be used within AppShell.");
  }
  return context;
}
