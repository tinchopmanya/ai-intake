"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { OnboardingBottomAction } from "@/components/onboarding/OnboardingBottomAction";
import { OnboardingOptionCard } from "@/components/onboarding/OnboardingOptionCard";
import { OnboardingStepTitle } from "@/components/onboarding/OnboardingStepTitle";
import { OnboardingWizardShell } from "@/components/onboarding/OnboardingWizardShell";
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
const COUNTRY_OPTIONS = [
  { code: "UY", label: "Uruguay" },
  { code: "AR", label: "Argentina" },
  { code: "CL", label: "Chile" },
  { code: "MX", label: "Mexico" },
  { code: "ES", label: "Espana" },
  { code: "US", label: "Estados Unidos" },
  { code: "BR", label: "Brasil" },
] as const;
const LANGUAGE_OPTIONS = [
  { code: "es", label: "Espanol" },
  { code: "en", label: "English" },
  { code: "pt", label: "Portugues" },
] as const;

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
  const [currentStep, setCurrentStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [useCustomCountry, setUseCustomCountry] = useState(false);

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
        const resolvedCountryCode = (profile.country_code || user.country_code || "UY").toUpperCase();
        setCountryCode(resolvedCountryCode);
        setLanguageCode((profile.language_code || user.language_code || "es") as "es" | "en" | "pt");
        setUseCustomCountry(!COUNTRY_OPTIONS.some((item) => item.code === resolvedCountryCode));
      } catch {
        setCountryCode((user.country_code || "UY").toUpperCase());
        setLanguageCode((user.language_code || "es") as "es" | "en" | "pt");
      } finally {
        setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [router]);

  const progress = useMemo(() => ((currentStep + 1) / 5) * 100, [currentStep]);

  async function handleSubmit() {
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

  function chooseBreakupSide(value: "yo" | "mi_ex" | "mutuo") {
    if (saving) return;
    setBreakupSide(value);
    window.setTimeout(() => setCurrentStep(2), 120);
  }

  function chooseHasChildren(value: boolean) {
    if (saving) return;
    setHasChildren(value);
    window.setTimeout(() => setCurrentStep(3), 120);
  }

  function chooseCountry(code: string) {
    if (saving) return;
    setUseCustomCountry(false);
    setCountryCode(code);
    window.setTimeout(() => setCurrentStep(4), 120);
  }

  async function chooseLanguage(value: "es" | "en" | "pt") {
    if (saving) return;
    setLanguageCode(value);
    await handleSubmit();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3f4f6] p-6 text-sm text-[#667085]">
        Cargando onboarding...
      </main>
    );
  }

  const breakupOptions: Array<{ value: "yo" | "mi_ex" | "mutuo"; label: string }> = [
    { value: "yo", label: t("onboarding.breakup_i_left") },
    { value: "mi_ex", label: t("onboarding.breakup_ex_left") },
    { value: "mutuo", label: t("onboarding.breakup_mutual") },
  ];

  return (
    <OnboardingWizardShell
      progress={progress}
      error={error}
      bottomAction={
        currentStep === 0 ? (
          <OnboardingBottomAction
            label="Next"
            disabled={objective.trim().length === 0 || saving}
            onClick={() => setCurrentStep(1)}
          />
        ) : currentStep === 3 && useCustomCountry ? (
          <OnboardingBottomAction
            label="Next"
            disabled={countryCode.trim().length < 2 || saving}
            onClick={() => setCurrentStep(4)}
          />
        ) : null
      }
    >
      {currentStep === 0 ? (
        <>
          <OnboardingStepTitle
            title={t("onboarding.objective")}
            subtitle={t("onboarding.subtitle")}
          />
          <div className="rounded-2xl border border-[#e3e7ee] bg-[#eceff3] p-1.5">
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              className="min-h-[180px] w-full resize-none rounded-xl border border-transparent bg-transparent px-4 py-3 text-[16px] leading-6 text-[#1f2a44] placeholder:text-[#667085] focus:border-[#d1d8e4] focus:bg-white/40 focus:outline-none"
              placeholder={t("onboarding.objective_placeholder")}
              required
            />
          </div>
        </>
      ) : null}

      {currentStep === 1 ? (
        <>
          <OnboardingStepTitle
            title={t("onboarding.breakup_side")}
            subtitle="Selecciona una opcion y avanzamos automaticamente."
          />
          <div className="space-y-3">
            {breakupOptions.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                selected={breakupSide === item.value}
                onClick={() => chooseBreakupSide(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {currentStep === 2 ? (
        <>
          <OnboardingStepTitle
            title={t("onboarding.has_children")}
            subtitle="Esto nos ayuda a ajustar mejor el tono de las sugerencias."
          />
          <div className="space-y-3">
            <OnboardingOptionCard
              label="Si, tenemos hijos"
              selected={hasChildren === true}
              onClick={() => chooseHasChildren(true)}
            />
            <OnboardingOptionCard
              label="No tenemos hijos"
              selected={hasChildren === false}
              onClick={() => chooseHasChildren(false)}
            />
          </div>
        </>
      ) : null}

      {currentStep === 3 ? (
        <>
          <OnboardingStepTitle
            title={t("onboarding.country")}
            subtitle="Selecciona tu pais principal."
          />
          <div className="space-y-3">
            {COUNTRY_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.code}
                label={item.label}
                description={item.code}
                selected={!useCustomCountry && countryCode === item.code}
                onClick={() => chooseCountry(item.code)}
              />
            ))}
            <OnboardingOptionCard
              label="Otro pais (ISO-2)"
              selected={useCustomCountry}
              onClick={() => setUseCustomCountry(true)}
            />
            {useCustomCountry ? (
              <div className="rounded-2xl border border-[#e3e7ee] bg-[#eceff3] p-1.5">
                <input
                  value={countryCode}
                  onChange={(event) =>
                    setCountryCode(event.target.value.trim().toUpperCase().slice(0, 2))
                  }
                  className="h-14 w-full rounded-xl border border-transparent bg-transparent px-4 text-base font-semibold uppercase text-[#1f2a44] placeholder:text-[#667085] focus:border-[#d1d8e4] focus:bg-white/40 focus:outline-none"
                  placeholder="Ej: UY"
                  maxLength={2}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {currentStep === 4 ? (
        <>
          <OnboardingStepTitle
            title={t("onboarding.language")}
            subtitle={saving ? t("onboarding.saving") : "Selecciona idioma y finalizamos."}
          />
          <div className="space-y-3">
            {LANGUAGE_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.code}
                label={item.label}
                selected={languageCode === item.code}
                onClick={() => void chooseLanguage(item.code)}
              />
            ))}
          </div>
        </>
      ) : null}
    </OnboardingWizardShell>
  );
}
