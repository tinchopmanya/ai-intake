"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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

type GoogleInitState =
  | "idle"
  | "loading_sdk"
  | "missing_client_id"
  | "sdk_load_failed"
  | "sdk_unavailable"
  | "ready";

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  google_client_id_not_configured:
    "La configuracion de Google OAuth no esta lista en el backend.",
  google_auth_library_missing: "Falta una dependencia de autenticacion en el backend.",
  invalid_google_token: "Google devolvio un token invalido. Intenta nuevamente.",
  google_token_verification_timeout:
    "Google esta demorando demasiado en validar el acceso. Intenta nuevamente.",
  google_token_verification_unavailable:
    "Google no pudo validar el acceso en este momento. Intenta nuevamente.",
  auth_request_timeout: "La autenticacion demoro demasiado. Intenta nuevamente.",
  network_unavailable: "No se pudo conectar con el backend.",
  database_unavailable: "La base de datos no esta disponible temporalmente.",
  user_persistence_failed: "No se pudo crear o actualizar tu usuario.",
  session_persistence_failed: "No se pudo iniciar tu sesion. Reintenta.",
  auth_internal_error: "Ocurrio un error interno al autenticar.",
};

function readGoogleClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
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

function getGoogleInitErrorMessage(state: GoogleInitState): string | null {
  switch (state) {
    case "missing_client_id":
      return "Falta NEXT_PUBLIC_GOOGLE_CLIENT_ID para iniciar sesion con Google.";
    case "sdk_load_failed":
      return "No se pudo cargar Google Sign-In. Reintenta en unos segundos.";
    case "sdk_unavailable":
      return "Google Sign-In no esta disponible en este navegador.";
    default:
      return null;
  }
}

function getGoogleStatusLabel(state: GoogleInitState, loading: boolean): string {
  if (loading) return "Autenticando...";
  switch (state) {
    case "loading_sdk":
      return "Cargando Google Sign-In...";
    case "missing_client_id":
      return "Google Sign-In no configurado";
    case "sdk_load_failed":
      return "No se pudo cargar Google";
    case "sdk_unavailable":
      return "Google Sign-In no disponible";
    case "ready":
      return "Continuar con Google";
    case "idle":
    default:
      return "Preparando Google...";
  }
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const buttonHostRef = useRef<HTMLDivElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleInitState, setGoogleInitState] = useState<GoogleInitState>("idle");
  const [manualToken, setManualToken] = useState("");
  const googleClientId = readGoogleClientId();
  const loadingRef = useRef(false);

  const nextFromQuery = resolveSafeNextPath(searchParams.get("next"));

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const handleLogin = useCallback(
    async (idToken: string) => {
      if (loadingRef.current) return;
      setLoading(true);
      setErrorMessage(null);
      try {
        const user = await loginWithGoogleIdToken(idToken);
        const nextPath = user.onboarding_completed ? nextFromQuery || "/mvp" : "/onboarding";
        if (typeof window !== "undefined") {
          window.location.assign(nextPath);
        } else {
          router.replace(nextPath);
        }
      } catch (exc) {
        setErrorMessage(mapLoginError(exc));
      } finally {
        setLoading(false);
      }
    },
    [nextFromQuery, router],
  );

  const initializeGoogleSignIn = useCallback(() => {
    if (!googleClientId) {
      setGoogleReady(false);
      setGoogleInitState("missing_client_id");
      setLoading(false);
      setErrorMessage("Falta NEXT_PUBLIC_GOOGLE_CLIENT_ID para iniciar sesion con Google.");
      return false;
    }

    const googleApi = (window as { google?: GoogleApi }).google;
    if (!googleApi?.accounts?.id || !buttonHostRef.current) {
      setGoogleReady(false);
      setGoogleInitState("sdk_unavailable");
      setLoading(false);
      setErrorMessage("Google Sign-In no esta disponible en este navegador.");
      return false;
    }

    try {
      buttonHostRef.current.replaceChildren();
      googleApi.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: GoogleCredentialResponse) => {
          const credential = response.credential?.trim();
          if (!credential) {
            setLoading(false);
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
      setGoogleInitState("ready");
      setLoading(false);
      setErrorMessage(null);
      return true;
    } catch {
      setGoogleReady(false);
      setGoogleInitState("sdk_unavailable");
      setLoading(false);
      setErrorMessage("No se pudo preparar Google Sign-In. Reintenta en unos segundos.");
      return false;
    }
  }, [googleClientId, handleLogin]);

  useEffect(() => {
    let mounted = true;

    async function redirectWhenAlreadyAuthenticated() {
      const user = await getCurrentUser();
      if (!mounted || !user) return;
      const nextPath = user.onboarding_completed ? nextFromQuery || "/mvp" : "/onboarding";
      router.replace(nextPath);
    }

    void redirectWhenAlreadyAuthenticated();

    if (!googleClientId) {
      setGoogleReady(false);
      setGoogleInitState("missing_client_id");
      setLoading(false);
      setErrorMessage("Falta NEXT_PUBLIC_GOOGLE_CLIENT_ID para iniciar sesion con Google.");
      return;
    }

    setGoogleReady(false);
    setGoogleInitState("loading_sdk");
    setLoading(false);

    const onGoogleLoaded = () => {
      if (!mounted) return;
      initializeGoogleSignIn();
    };

    const onGoogleLoadError = () => {
      if (!mounted) return;
      setGoogleReady(false);
      setGoogleInitState("sdk_load_failed");
      setLoading(false);
      setErrorMessage("No se pudo cargar Google Sign-In. Reintenta en unos segundos.");
    };

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_GSI_SRC}"]`);
    const script = existingScript ?? document.createElement("script");

    if ((window as { google?: GoogleApi }).google?.accounts?.id) {
      onGoogleLoaded();
    } else {
      script.addEventListener("load", onGoogleLoaded);
      script.addEventListener("error", onGoogleLoadError);

      if (!existingScript) {
        script.src = GOOGLE_GSI_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }

    return () => {
      mounted = false;
      script.removeEventListener("load", onGoogleLoaded);
      script.removeEventListener("error", onGoogleLoadError);
    };
  }, [googleClientId, initializeGoogleSignIn, nextFromQuery, router]);

  const googleStatusLabel = getGoogleStatusLabel(googleInitState, loading);
  const googleInitError = getGoogleInitErrorMessage(googleInitState);
  const resolvedErrorMessage = errorMessage ?? googleInitError;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--login-bg)] p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(99,102,241,0.25),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(99,102,241,0.12),transparent_45%)]" />
      <LoginCard errorMessage={resolvedErrorMessage}>
        <GoogleButton
          loading={loading}
          googleReady={googleReady}
          statusLabel={googleStatusLabel}
          buttonHostRef={buttonHostRef}
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
