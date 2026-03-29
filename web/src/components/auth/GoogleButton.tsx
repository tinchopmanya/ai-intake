"use client";

import type { RefObject } from "react";

type GoogleButtonProps = {
  loading: boolean;
  googleReady: boolean;
  statusLabel: string;
  buttonHostRef: RefObject<HTMLDivElement | null>;
};

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12S6.7 21.7 12 21.7c6.9 0 9.1-4.8 9.1-7.3 0-.5 0-.8-.1-1.2H12Z"
      />
      <path
        fill="#34A853"
        d="M2.4 7.5 5.6 9.9c.9-1.9 2.8-3.3 5-3.3 1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.3 12 2.3 8.1 2.3 4.8 4.5 2.4 7.5Z"
      />
      <path
        fill="#FBBC05"
        d="M12 21.7c2.6 0 4.8-.9 6.4-2.6l-3-2.5c-.8.6-2 1.1-3.4 1.1-2.6 0-4.8-1.7-5.6-4.1l-3.3 2.5c1.4 2.8 4.4 4.6 8.9 4.6Z"
      />
      <path
        fill="#4285F4"
        d="M21.1 12.4c0-.5 0-.8-.1-1.2H12v3.9h5.5c-.2 1.2-1 2.4-2.1 3.1l3 2.5c1.8-1.6 2.7-4 2.7-6.8Z"
      />
    </svg>
  );
}

export function GoogleButton({
  loading,
  googleReady,
  statusLabel,
  buttonHostRef,
}: GoogleButtonProps) {
  return (
    <div className="space-y-3">
      {!googleReady ? (
        <div className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-[var(--login-border)] bg-white/5 px-5 py-3 text-sm font-medium text-[var(--login-text-primary)] opacity-70">
          <GoogleIcon />
          <span>{statusLabel}</span>
        </div>
      ) : null}

      <div
        ref={buttonHostRef}
        className={`flex min-h-[44px] items-center justify-center overflow-hidden rounded-full border border-[var(--login-border)] bg-black/20 p-1 ${
          googleReady && !loading ? "opacity-100" : "pointer-events-none opacity-60"
        }`}
      />
      {googleReady && loading ? (
        <p className="text-center text-sm text-[var(--login-text-muted)]">Autenticando...</p>
      ) : null}
    </div>
  );
}
