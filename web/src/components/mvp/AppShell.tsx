import type { ReactNode } from "react";
import Link from "next/link";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">ai-intake MVP</h1>
          <p className="text-sm text-gray-600">Base del wizard advisor</p>
        </div>
        <Link href="/" className="text-sm text-gray-700 underline">
          Inicio
        </Link>
      </header>
      {children}
    </main>
  );
}

