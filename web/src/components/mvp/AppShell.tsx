import type { ReactNode } from "react";
import Link from "next/link";

import { Panel } from "@/components/mvp/ui";

type AppShellProps = {
  children: ReactNode;
};

/**
 * Shared layout shell for MVP screens with header and constrained container.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1080px] min-w-0 flex-col gap-4 overflow-x-hidden bg-[#f3f4f6] px-5 py-6">
      <Panel className="mx-auto flex w-full items-center justify-between border-[#e5e7eb] bg-white px-4 py-3">
        <div>
          <h1 className="text-xl font-bold text-[#1f2937]">Consejero de Conversaciones</h1>
          <p className="mt-1 text-sm text-[#334155]">
            Pega una conversacion dificil y revisa tres perspectivas antes de responder.
          </p>
        </div>
        <Link href="/" className="text-sm text-[#334155] underline underline-offset-2">
          Inicio
        </Link>
      </Panel>
      <section className="mx-auto w-full min-w-0">{children}</section>
    </main>
  );
}

