import type { ReactNode } from "react";
import Link from "next/link";

import { Panel } from "@/components/mvp/ui";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-2 bg-gray-100/60 px-2 py-2 md:px-3 md:py-3">
      <Panel className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-2.5">
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
      <section className="mx-auto w-full max-w-4xl min-w-0">{children}</section>
    </main>
  );
}

