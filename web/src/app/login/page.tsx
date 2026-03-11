"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { loginWithGoogleIdToken } from "@/lib/auth/client";

const GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdApi = {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: {
      type: string;
      size: string;
      shape: string;
      text: string;
      theme: string;
      width: number;
    },
  ) => void;
};

type GoogleApi = {
  accounts?: {
    id?: GoogleIdApi;
  };
};

function readGoogleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const buttonHostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState("");

  const handleLogin = useCallback(
    async (idToken: string) => {
      setLoading(true);
      setError(null);
      try {
        await loginWithGoogleIdToken(idToken);
        const nextPath = searchParams.get("next") || "/mvp";
        router.replace(nextPath);
      } catch {
        setError("No se pudo iniciar sesion con Google.");
      } finally {
        setLoading(false);
      }
    },
    [router, searchParams],
  );

  useEffect(() => {
    const clientId = readGoogleClientId();
    if (!clientId) {
      setError("Falta NEXT_PUBLIC_GOOGLE_CLIENT_ID para renderizar Google Sign-In.");
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const googleApi = (window as { google?: GoogleApi }).google;
      if (!googleApi?.accounts?.id || !buttonHostRef.current) return;

      googleApi.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: GoogleCredentialResponse) => {
          const credential = response.credential;
          if (!credential) {
            setError("Google no devolvio credenciales.");
            return;
          }
          await handleLogin(credential);
        },
      });

      googleApi.accounts.id.renderButton(buttonHostRef.current, {
        type: "standard",
        size: "large",
        shape: "pill",
        text: "signin_with",
        theme: "outline",
        width: 320,
      });
    };
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [handleLogin]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold text-gray-900">Iniciar sesion</h1>
      <p className="text-sm text-gray-600">
        Accede con Google para continuar al flujo de ZeroContact Emocional.
      </p>

      <div ref={buttonHostRef} className="min-h-[44px]" />

      <div className="rounded border border-gray-200 p-3">
        <p className="mb-2 text-sm font-medium text-gray-800">Fallback (ID token manual)</p>
        <textarea
          value={manualToken}
          onChange={(event) => setManualToken(event.target.value)}
          className="min-h-[120px] w-full rounded border border-gray-300 p-2 text-xs"
          placeholder="Pega aqui un Google ID token para pruebas locales"
          disabled={loading}
        />
        <button
          type="button"
          onClick={() => handleLogin(manualToken.trim())}
          disabled={loading || manualToken.trim().length === 0}
          className="mt-2 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Autenticando..." : "Entrar con token manual"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
