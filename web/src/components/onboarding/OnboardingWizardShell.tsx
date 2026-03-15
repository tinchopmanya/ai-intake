import type { ReactNode } from "react";

import { OnboardingProgressBar } from "@/components/onboarding/OnboardingProgressBar";

type OnboardingWizardShellProps = {
  progress: number;
  children: ReactNode;
  bottomAction?: ReactNode;
  error?: string | null;
};

export function OnboardingWizardShell({
  progress,
  children,
  bottomAction,
  error,
}: OnboardingWizardShellProps) {
  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-4 sm:px-6 sm:py-5">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-[720px] flex-col">
        <div className="mb-6">
          <OnboardingProgressBar value={progress} />
        </div>

        <section className="flex-1 space-y-5 overflow-y-auto pb-4">{children}</section>

        {error ? (
          <div className="mb-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
            {error}
          </div>
        ) : null}

        {bottomAction ? (
          <div className="sticky bottom-0 z-10 mt-2 border-t border-[#E2E8F0] bg-[#F8FAFC]/95 pb-2 pt-3 backdrop-blur">
            {bottomAction}
          </div>
        ) : null}
      </div>
    </main>
  );
}

