"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { DevTokenSection } from "@/components/auth/DevTokenSection";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { LoginCard } from "@/components/auth/LoginCard";
import { AuthApiError, getCurrentUser, loginWithGoogleIdToken } from "@/lib/auth/client";

const GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";
const IS_DEV = process.env.NODE_ENV !== "production";

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

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  google_client_id_not_configured:
    "La configuracion de Google OAuth no esta lista en el backend.",
  google_auth_library_missing: "Falta una dependencia de autenticacion en el backend.",
  invalid_google_token: "Google devolvio un token invalido. Intenta nuevamente.",
  database_unavailable: "La base de datos no esta disponible temporalmente.",
  user_persistence_failed: "No se pudo crear o actualizar tu usuario.",
  session_persistence_failed: "No se pudo iniciar tu sesion. Reintenta.",
  auth_internal_error: "Ocurrio un error interno al autenticar.",
};

function readGoogleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
}

function resolveSafeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  return raw;
}

function mapLoginError(error: unknown): string {
  if (error instanceof AuthApiError) {
    return (
      LOGIN_ERROR_MESSAGES[error.code] ||
      error.backendMessage ||
      "No se pudo iniciar sesion en este momento."
    );
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "No se pudo iniciar sesion en este momento.";
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const buttonHostRef = useRef<HTMLDivElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [manualToken, setManualToken] = useState("");

  const nextFromQuery = resolveSafeNextPath(searchParams.get("next"));

  const handleLogin = useCallback(
    async (idToken: string) => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const user = await loginWithGoogleIdToken(idToken);
        const nextPath = user.onboarding_completed ? nextFromQuery || "/mvp" : "/onboarding";
        router.replace(nextPath);
      } catch (exc) {
        setErrorMessage(mapLoginError(exc));
      } finally {
        setLoading(false);
      }
    },
    [nextFromQuery, router],
  );

  useEffect(() => {
    let mounted = true;

    async function redirectWhenAlreadyAuthenticated() {
      const user = await getCurrentUser();
      if (!mounted || !user) return;
      const nextPath = user.onboarding_completed ? nextFromQuery || "/mvp" : "/onboarding";
      router.replace(nextPath);
    }

    void redirectWhenAlreadyAuthenticated();

    const clientId = readGoogleClientId();
    if (!clientId) {
      setErrorMessage("Falta NEXT_PUBLIC_GOOGLE_CLIENT_ID para renderizar Google Sign-In.");
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      if (mounted) {
        setErrorMessage("No se pudo cargar Google Sign-In. Reintenta en unos segundos.");
      }
    };
    script.onload = () => {
      if (!mounted) return;
      const googleApi = (window as { google?: GoogleApi }).google;
      if (!googleApi?.accounts?.id || !buttonHostRef.current) {
        setErrorMessage("Google Sign-In no disponible en este navegador.");
        return;
      }

      googleApi.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: GoogleCredentialResponse) => {
          const credential = response.credential;
          if (!credential) {
            setErrorMessage("Google no devolvio credenciales.");
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
        theme: "filled_black",
        width: 320,
      });
      setGoogleReady(true);
    };
    document.head.appendChild(script);

    return () => {
      mounted = false;
      script.remove();
    };
  }, [handleLogin, nextFromQuery, router]);

  function handleGoogleButtonClick() {
    const trigger = buttonHostRef.current?.querySelector<HTMLElement>('[role="button"]');
    if (trigger) {
      trigger.click();
      return;
    }
    setErrorMessage("Google Sign-In todavia no esta listo. Intenta de nuevo en unos segundos.");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--login-bg)] p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(99,102,241,0.25),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(99,102,241,0.12),transparent_45%)]" />
      <LoginCard errorMessage={errorMessage}>
        <GoogleButton
          disabled={!googleReady || loading}
          loading={loading}
          googleReady={googleReady}
          buttonHostRef={buttonHostRef}
          onClick={handleGoogleButtonClick}
        />

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--login-border)]" />
          <span className="text-xs uppercase tracking-[0.12em] text-[var(--login-text-muted)]">o</span>
          <span className="h-px flex-1 bg-[var(--login-border)]" />
        </div>

        {IS_DEV ? (
          <DevTokenSection
            loading={loading}
            manualToken={manualToken}
            onManualTokenChange={setManualToken}
            onSubmit={() => void handleLogin(manualToken.trim())}
          />
        ) : (
          <p className="text-xs text-[var(--login-text-muted)]">
            Si el acceso falla, vuelve a intentar en unos segundos.
          </p>
        )}
      </LoginCard>
    </main>
  );
}
