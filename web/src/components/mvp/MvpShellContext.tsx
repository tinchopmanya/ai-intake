"use client";

import { createContext, useContext } from "react";

export type SidebarConversationSummary = {
  title: string;
  startedAt: string;
};

type MvpShellContextValue = {
  displayName: string;
  initials: string;
  sidebarConversation: SidebarConversationSummary | null;
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
