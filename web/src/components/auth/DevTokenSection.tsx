"use client";

import { useState } from "react";

type DevTokenSectionProps = {
  loading: boolean;
  manualToken: string;
  onManualTokenChange: (value: string) => void;
  onSubmit: () => void;
};

export function DevTokenSection({
  loading,
  manualToken,
  onManualTokenChange,
  onSubmit,
}: DevTokenSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-[var(--login-border)] bg-black/20 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-medium text-[var(--login-text-primary)]">Fallback dev</span>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300">
          DEV ONLY
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={manualToken}
            onChange={(event) => onManualTokenChange(event.target.value)}
            className="min-h-[130px] w-full rounded-xl border border-[var(--login-border)] bg-black/30 p-3 text-xs text-[var(--login-text-primary)] placeholder:text-[var(--login-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent)]/60"
            placeholder="Pega aqui un Google ID token para pruebas locales"
            disabled={loading}
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || manualToken.trim().length === 0}
            className="inline-flex w-full items-center justify-center rounded-full border border-[var(--login-border)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--login-text-primary)] transition duration-200 hover:border-[color:var(--login-accent)]/60 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent)]/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Autenticando..." : "Entrar con token manual"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

