"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authFetch, getCurrentUser } from "@/lib/auth/client";
import { API_URL } from "@/lib/config";
import { resolveRuntimeLocale, tRuntime } from "@/lib/i18n/runtime";

type OnboardingProfileResponse = {
  objective: string | null;
  has_children: boolean | null;
  breakup_side: "yo" | "mi_ex" | "mutuo" | null;
  country_code: string;
  language_code: "es" | "en" | "pt";
  onboarding_completed: boolean;
};

const PROFILE_URL = `${API_URL}/v1/onboarding/profile`;

export default function OnboardingPage() {
  const router = useRouter();
  const locale = resolveRuntimeLocale();
  const t = (key: string) => tRuntime(key, locale);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [hasChildren, setHasChildren] = useState(false);
  const [breakupSide, setBreakupSide] = useState<"yo" | "mi_ex" | "mutuo">("mutuo");
  const [countryCode, setCountryCode] = useState("UY");
  const [languageCode, setLanguageCode] = useState<"es" | "en" | "pt">("es");

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      const user = await getCurrentUser();
      if (!mounted) return;
      if (!user) {
        router.replace("/login?next=%2Fonboarding");
        return;
      }
      try {
        const response = await authFetch(PROFILE_URL, { method: "GET", cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const profile = (await response.json()) as OnboardingProfileResponse;
        if (profile.onboarding_completed) {
          router.replace("/mvp");
          return;
        }
        setObjective(profile.objective ?? "");
        setHasChildren(Boolean(profile.has_children));
        setBreakupSide((profile.breakup_side ?? "mutuo") as "yo" | "mi_ex" | "mutuo");
        setCountryCode((profile.country_code || user.country_code || "UY").toUpperCase());
        setLanguageCode((profile.language_code || user.language_code || "es") as "es" | "en" | "pt");
      } catch {
        setCountryCode((user.country_code || "UY").toUpperCase());
        setLanguageCode((user.language_code || "es") as "es" | "en" | "pt");
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!objective.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authFetch(PROFILE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: objective.trim(),
          has_children: hasChildren,
          breakup_side: breakupSide,
          country_code: countryCode.trim().toUpperCase().slice(0, 2),
          language_code: languageCode,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; detail?: string }
          | null;
        throw new Error(payload?.message || payload?.detail || `HTTP ${response.status}`);
      }
      router.replace("/mvp");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "No se pudo guardar onboarding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="p-6 text-sm text-gray-600">Cargando onboarding...</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-gray-900">{t("onboarding.title")}</h1>
      <p className="text-sm text-gray-600">{t("onboarding.subtitle")}</p>

      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-gray-200 p-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-800">{t("onboarding.objective")}</label>
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            className="min-h-[90px] w-full rounded border border-gray-300 p-2 text-sm"
            placeholder={t("onboarding.objective_placeholder")}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-800">{t("onboarding.breakup_side")}</label>
          <select
            value={breakupSide}
            onChange={(event) => setBreakupSide(event.target.value as "yo" | "mi_ex" | "mutuo")}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          >
            <option value="yo">{t("onboarding.breakup_i_left")}</option>
            <option value="mi_ex">{t("onboarding.breakup_ex_left")}</option>
            <option value="mutuo">{t("onboarding.breakup_mutual")}</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={hasChildren}
            onChange={(event) => setHasChildren(event.target.checked)}
          />
          {t("onboarding.has_children")}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-800">{t("onboarding.country")}</label>
            <input
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              className="w-full rounded border border-gray-300 p-2 text-sm uppercase"
              maxLength={2}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-800">{t("onboarding.language")}</label>
            <select
              value={languageCode}
              onChange={(event) => setLanguageCode(event.target.value as "es" | "en" | "pt")}
              className="w-full rounded border border-gray-300 p-2 text-sm"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
            </select>
          </div>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={saving || objective.trim().length === 0}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? t("onboarding.saving") : t("onboarding.submit")}
        </button>
      </form>
    </main>
  );
}
