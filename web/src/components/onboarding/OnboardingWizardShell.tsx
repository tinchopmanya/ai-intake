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
    <main className="min-h-screen bg-[#f3f4f6] px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[430px] flex-col">
        <div className="mb-8">
          <OnboardingProgressBar value={progress} />
        </div>

        <section className="flex-1 space-y-6">{children}</section>

        {error ? (
          <div className="mb-3 rounded-2xl border border-[#f1b7b7] bg-[#feeaea] px-4 py-3 text-sm text-[#9d2f2f]">
            {error}
          </div>
        ) : null}

        {bottomAction ? (
          <div className="sticky bottom-0 mt-4 bg-gradient-to-t from-[#f3f4f6] via-[#f3f4f6] to-transparent pb-2 pt-4">
            {bottomAction}
          </div>
        ) : null}
      </div>
    </main>
  );
}

