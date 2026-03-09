import type { ReactNode } from "react";
import Link from "next/link";

import { AdvisorSidebar } from "@/components/mvp/AdvisorSidebar";
import { Panel } from "@/components/mvp/ui";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-3 bg-gray-100/60 p-3 md:p-4">
      <Panel className="flex items-center justify-between px-4 py-2.5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Consejero de Conversaciones</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            Pega una conversacion dificil y revisa tres perspectivas antes de responder.
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-700 underline underline-offset-2">
          Inicio
        </Link>
      </Panel>
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px] lg:items-start">
        <div className="min-w-0 order-2 lg:order-1">{children}</div>
        <div className="order-1 lg:order-2">
          <AdvisorSidebar />
        </div>
      </section>
    </main>
  );
}

