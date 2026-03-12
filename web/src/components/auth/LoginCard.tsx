"use client";

import type { ReactNode } from "react";

type LoginCardProps = {
  errorMessage: string | null;
  children: ReactNode;
};

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 shrink-0">
      <path
        d="M12 3 22 21H2L12 3Zm0 5.5a1 1 0 0 0-1 1V14a1 1 0 1 0 2 0V9.5a1 1 0 0 0-1-1Zm0 9a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LoginCard({ errorMessage, children }: LoginCardProps) {
  return (
    <section className="login-card-in relative w-full max-w-md overflow-hidden rounded-3xl border border-[var(--login-border)] bg-[var(--login-surface)] p-6 text-[var(--login-text-primary)] shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
      <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.35),rgba(99,102,241,0))]" />
      <div className="relative">
        <span className="inline-flex items-center rounded-full border border-[var(--login-border)] bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--login-text-muted)]">
          ZeroContact Emotional
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[var(--login-text-primary)]">
          Iniciar sesion
        </h1>
        <p className="mt-2 text-sm text-[var(--login-text-muted)]">
          Accede con Google para continuar
        </p>

        {errorMessage ? (
          <div className="mt-5 rounded-2xl border border-[color:var(--login-error)]/40 bg-[color:var(--login-error)]/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--login-error)]">
              <AlertIcon />
              Error al iniciar sesion
            </p>
            <p className="mt-1 text-sm text-[var(--login-text-primary)]/90">{errorMessage}</p>
          </div>
        ) : null}

        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}
