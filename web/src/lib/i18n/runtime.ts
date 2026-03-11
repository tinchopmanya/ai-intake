import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import pt from "@/i18n/messages/pt.json";

type LocaleCode = "es" | "en" | "pt";
type Messages = Record<string, string>;

const CATALOG: Record<LocaleCode, Messages> = {
  es,
  en,
  pt,
};

const FALLBACK_LOCALE: LocaleCode = "es";
const SESSION_STORAGE_KEY = "zc_auth_session_v1";

type SessionLike = {
  user?: {
    language_code?: string;
  };
};

export function resolveRuntimeLocale(): LocaleCode {
  if (typeof window === "undefined") return FALLBACK_LOCALE;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return FALLBACK_LOCALE;
  try {
    const session = JSON.parse(raw) as SessionLike;
    const candidate = String(session.user?.language_code || "")
      .trim()
      .toLowerCase();
    if (candidate === "en" || candidate === "pt" || candidate === "es") {
      return candidate;
    }
  } catch {
    return FALLBACK_LOCALE;
  }
  return FALLBACK_LOCALE;
}

export function runtimeMessages(locale: LocaleCode): Messages {
  return CATALOG[locale] ?? CATALOG[FALLBACK_LOCALE];
}

export function tRuntime(key: string, locale?: LocaleCode): string {
  const resolved = locale ?? resolveRuntimeLocale();
  return runtimeMessages(resolved)[key] ?? key;
}
