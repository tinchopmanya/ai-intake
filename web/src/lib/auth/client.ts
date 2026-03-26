import { API_URL } from "@/lib/config";

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  memory_opt_in: boolean;
  locale: string | null;
  picture_url: string | null;
  country_code: string;
  language_code: string;
  onboarding_completed: boolean;
};

type AuthResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in: number;
  user: AuthUser;
};

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  user: AuthUser;
};

export class AuthApiError extends Error {
  code: string;
  status: number;
  backendMessage: string | null;

  constructor(params: { code: string; status: number; backendMessage?: string | null }) {
    super(params.code);
    this.name = "AuthApiError";
    this.code = params.code;
    this.status = params.status;
    this.backendMessage = params.backendMessage ?? null;
  }
}

const SESSION_STORAGE_KEY = "zc_auth_session_v1";
const ACCESS_SKEW_MS = 30_000;

function buildNetworkErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      detail: "network_unavailable",
      message: "No se pudo conectar con el backend.",
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function nowMs(): number {
  return Date.now();
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    if (!parsed.tokenType || parsed.tokenType.toLowerCase() !== "bearer") return null;
    if (!Number.isFinite(parsed.accessExpiresAt) || !Number.isFinite(parsed.refreshExpiresAt)) {
      return null;
    }
    if (!parsed.user || !parsed.user.id || !parsed.user.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readSession(): StoredSession | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  const parsed = parseSession(raw);
  if (!parsed && raw) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
  return parsed;
}

function writeSessionFromAuthResponse(payload: AuthResponse): StoredSession {
  const session: StoredSession = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type,
    accessExpiresAt: nowMs() + payload.expires_in * 1000,
    refreshExpiresAt: nowMs() + payload.refresh_expires_in * 1000,
    user: payload.user,
  };
  if (isBrowser()) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
  return session;
}

function clearSession(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function isAccessExpired(session: StoredSession): boolean {
  return session.accessExpiresAt - ACCESS_SKEW_MS <= nowMs();
}

function isRefreshExpired(session: StoredSession): boolean {
  return session.refreshExpiresAt <= nowMs();
}

function resolvePreferredLanguage(): string {
  const session = readSession();
  const fromSession = String(session?.user.language_code || "")
    .trim()
    .toLowerCase();
  if (fromSession === "es" || fromSession === "en" || fromSession === "pt") {
    return fromSession;
  }
  if (isBrowser()) {
    const nav = String(window.navigator.language || "")
      .trim()
      .toLowerCase();
    if (nav.startsWith("en")) return "en";
    if (nav.startsWith("pt")) return "pt";
  }
  return "es";
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": resolvePreferredLanguage(),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { message?: string; detail?: string }
      | null;
    const detail = String(errorPayload?.detail || "").trim();
    const code = detail.length > 0 ? detail : `http_${response.status}`;
    throw new AuthApiError({
      code,
      status: response.status,
      backendMessage: errorPayload?.message ?? null,
    });
  }
  return (await response.json()) as T;
}

let refreshInFlight: Promise<StoredSession | null> | null = null;

async function refreshSessionInternal(): Promise<StoredSession | null> {
  const session = readSession();
  if (!session || isRefreshExpired(session)) {
    clearSession();
    return null;
  }

  const payload = await postJson<AuthResponse>("/v1/auth/refresh", {
    refresh_token: session.refreshToken,
  });
  return writeSessionFromAuthResponse(payload);
}

async function refreshSession(): Promise<StoredSession | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshSessionInternal()
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function getValidSession(): Promise<StoredSession | null> {
  const session = readSession();
  if (!session) return null;
  if (isRefreshExpired(session)) {
    clearSession();
    return null;
  }
  if (!isAccessExpired(session)) return session;
  return refreshSession();
}

async function getSessionForRequest(): Promise<StoredSession | null> {
  const session = readSession();
  if (!session) return null;
  if (isRefreshExpired(session)) {
    clearSession();
    return null;
  }
  if (!isAccessExpired(session)) return session;
  const refreshed = await refreshSession();
  if (refreshed) return refreshed;
  clearSession();
  return null;
}

export function hasStoredSession(): boolean {
  return readSession() !== null;
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retryOn401?: boolean },
): Promise<Response> {
  const retryOn401 = options?.retryOn401 ?? true;
  const session = await getSessionForRequest();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Accept-Language")) {
    headers.set("Accept-Language", resolvePreferredLanguage());
  }
  if (session) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(input, { ...init, headers });
  } catch {
    return buildNetworkErrorResponse();
  }
  if (response.status !== 401 || !retryOn401 || !session) {
    if (response.status === 401) {
      clearSession();
    }
    return response;
  }

  const refreshed = await refreshSession();
  if (!refreshed) {
    clearSession();
    return response;
  }

  const retryHeaders = new Headers(init?.headers ?? {});
  if (!retryHeaders.has("Accept-Language")) {
    retryHeaders.set("Accept-Language", resolvePreferredLanguage());
  }
  retryHeaders.set("Authorization", `Bearer ${refreshed.accessToken}`);
  try {
    return await fetch(input, { ...init, headers: retryHeaders });
  } catch {
    return buildNetworkErrorResponse();
  }
}

export async function loginWithGoogleIdToken(idToken: string): Promise<AuthUser> {
  const normalized = idToken.trim();
  if (!normalized) {
    throw new AuthApiError({ code: "invalid_google_token", status: 400 });
  }
  const payload = await postJson<AuthResponse>("/v1/auth/google", { id_token: normalized });
  const session = writeSessionFromAuthResponse(payload);
  return session.user;
}

export async function logoutSession(): Promise<void> {
  const session = readSession();
  try {
    if (session) {
      await postJson<{ revoked: boolean }>("/v1/auth/logout", {
        refresh_token: session.refreshToken,
      });
    }
  } catch {
    // Ignore logout API failures in client cleanup path.
  } finally {
    clearSession();
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getValidSession();
  if (!session) return null;

  const response = await authFetch(`${API_URL}/v1/auth/me`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) clearSession();
    return null;
  }
  const payload = (await response.json()) as { user: AuthUser };
  return payload.user;
}
