"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { OnboardingOptionCard } from "@/components/onboarding/OnboardingOptionCard";
import { OnboardingStepTitle } from "@/components/onboarding/OnboardingStepTitle";
import { OnboardingWizardShell } from "@/components/onboarding/OnboardingWizardShell";
import { toUiErrorMessage } from "@/lib/api/errors";
import { getOnboardingProfile, putOnboardingProfile } from "@/lib/api/client";
import type {
  BreakupInitiator,
  BreakupTimeRange,
  ChildrenCountCategory,
  CustodyType,
  OnboardingProfile,
  RelationshipMode,
  ResponseStyle,
} from "@/lib/api/types";
import { getCurrentUser } from "@/lib/auth/client";

const inputClassName =
  "h-12 w-full rounded-xl border border-[#CBD5E1] bg-white px-4 text-[16px] text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-[rgba(37,99,235,0.22)]";
const labelClassName = "block text-[15px] font-semibold text-[#334155]";

const RELATIONSHIP_MODE_OPTIONS: Array<{ value: RelationshipMode; label: string; description: string }> = [
  {
    value: "coparenting",
    label: "Tenemos hijos en común",
    description: "Necesito apoyo de comunicación enfocada en crianza y coordinación parental.",
  },
  {
    value: "relationship_separation",
    label: "No tenemos hijos en común",
    description: "Busco orientación emocional y claridad para atravesar la separación.",
  },
];

const BREAKUP_TIME_OPTIONS: Array<{ value: BreakupTimeRange; label: string }> = [
  { value: "lt_2m", label: "Menos de 2 meses" },
  { value: "between_2m_1y", label: "Entre 2 meses y un año" },
  { value: "between_1y_3y", label: "Entre 1 año y 3 años" },
  { value: "gt_3y", label: "Más de 3 años" },
];

const RELATIONSHIP_GOAL_OPTIONS = [
  {
    value: "emotional_recovery",
    label: "Recuperarme emocionalmente",
    description: "No quiero volver con él o ella. Prefiero distancia y foco en mí.",
  },
  {
    value: "friendly_close",
    label: "Amistosa y cercana",
    description: "Quiero un vínculo personal sano y una dinámica más flexible.",
  },
  {
    value: "open_reconciliation",
    label: "Abierta a la reconciliación",
    description: "Tengo interés en acercarme y evaluar retomar la relación.",
  },
] as const;

const BREAKUP_INITIATOR_OPTIONS: Array<{ value: BreakupInitiator; label: string }> = [
  { value: "mutual", label: "Fue mutuo" },
  { value: "partner", label: "Fue decisión de él o ella" },
  { value: "me", label: "Fue decisión mía" },
];

const CHILDREN_COUNT_OPTIONS: Array<{ value: ChildrenCountCategory; label: string }> = [
  { value: "one", label: "Sí, 1" },
  { value: "two_plus", label: "Sí, 2 o más" },
];

const CUSTODY_OPTIONS: Array<{ value: CustodyType; label: string }> = [
  {
    value: "partner_custody_visits",
    label: "La tenencia la tiene mi pareja y yo régimen de visitas",
  },
  { value: "shared_custody", label: "Tenencia compartida" },
  {
    value: "my_custody_partner_visits",
    label: "Yo tengo la tenencia y mi pareja régimen de visitas",
  },
  {
    value: "undefined",
    label: "Aún no definimos la tenencia y las visitas",
  },
];

const RESPONSE_STYLE_OPTIONS: Array<{ value: ResponseStyle; label: string; description: string }> = [
  {
    value: "strict_parental",
    label: "Estrictamente parental",
    description: "Límites firmes y foco exclusivo en temas de crianza.",
  },
  {
    value: "cordial_collaborative",
    label: "Cordial y colaborativa",
    description: "Comunicación respetuosa, pacífica y práctica por los niños.",
  },
  {
    value: "friendly_close",
    label: "Amistosa y cercana",
    description: "Buen vínculo personal y dinámica flexible.",
  },
  {
    value: "open_reconciliation",
    label: "Abierta a la reconciliación",
    description: "Interés en recuperar cercanía a nivel personal.",
  },
];

function getTotalSteps(mode: RelationshipMode | null): number {
  if (mode === "coparenting") return 7;
  if (mode === "relationship_separation") return 5;
  return 5;
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams.get("edit") === "1";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [relationshipMode, setRelationshipMode] = useState<RelationshipMode | null>(null);
  const [userName, setUserName] = useState("");
  const [userAge, setUserAge] = useState<number | "">("");
  const [exPartnerName, setExPartnerName] = useState("");
  const [exPartnerPronoun, setExPartnerPronoun] = useState<"el" | "ella">("el");
  const [breakupTimeRange, setBreakupTimeRange] = useState<BreakupTimeRange | null>(null);
  const [childrenCountCategory, setChildrenCountCategory] = useState<ChildrenCountCategory>("none");
  const [relationshipGoal, setRelationshipGoal] = useState<
    "emotional_recovery" | "friendly_close" | "open_reconciliation" | null
  >(null);
  const [breakupInitiator, setBreakupInitiator] = useState<BreakupInitiator | null>(null);
  const [custodyType, setCustodyType] = useState<CustodyType | null>(null);
  const [responseStyle, setResponseStyle] = useState<ResponseStyle | null>(null);
  const [countryCode, setCountryCode] = useState("UY");
  const [languageCode, setLanguageCode] = useState<"es" | "en" | "pt">("es");

  const totalSteps = getTotalSteps(relationshipMode);
  const progress = useMemo(() => (step / totalSteps) * 100, [step, totalSteps]);

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
        const profile = await getOnboardingProfile();
        if (!mounted) return;
        hydrateProfile(profile, user.name, user.country_code, user.language_code);
        if (profile.onboarding_completed && !editMode) {
          router.replace("/mvp");
          return;
        }
      } catch {
        setUserName(user.name ?? "");
        setCountryCode((user.country_code || "UY").toUpperCase());
        setLanguageCode((user.language_code || "es") as "es" | "en" | "pt");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    function hydrateProfile(
      profile: OnboardingProfile,
      fallbackName: string | null,
      fallbackCountry: string,
      fallbackLanguage: string,
    ) {
      const inferredMode: RelationshipMode =
        profile.relationship_mode ??
        (profile.children_count_category && profile.children_count_category !== "none"
          ? "coparenting"
          : "relationship_separation");
      setRelationshipMode(inferredMode);
      setUserName(profile.user_name ?? fallbackName ?? "");
      setUserAge(profile.user_age ?? "");
      setExPartnerName(profile.ex_partner_name ?? "");
      setExPartnerPronoun(profile.ex_partner_pronoun ?? "el");
      setBreakupTimeRange(profile.breakup_time_range ?? null);
      setChildrenCountCategory(profile.children_count_category ?? "none");
      setRelationshipGoal(profile.relationship_goal ?? null);
      setBreakupInitiator(profile.breakup_initiator ?? null);
      setCustodyType(profile.custody_type ?? null);
      setResponseStyle(profile.response_style ?? null);
      setCountryCode((profile.country_code || fallbackCountry || "UY").toUpperCase());
      setLanguageCode((profile.language_code || fallbackLanguage || "es") as "es" | "en" | "pt");
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [editMode, router]);

  function applyMode(value: RelationshipMode) {
    setRelationshipMode(value);
    const maxSteps = getTotalSteps(value);
    setStep((current) => Math.min(current, maxSteps));
    if (value === "relationship_separation") {
      setChildrenCountCategory("none");
      setCustodyType(null);
      setResponseStyle(null);
    } else {
      if (childrenCountCategory === "none") {
        setChildrenCountCategory("one");
      }
      setRelationshipGoal(null);
    }
  }

  function canGoNext(): boolean {
    if (step === 1) return relationshipMode !== null;
    if (step === 2) {
      return userName.trim().length > 0 && typeof userAge === "number" && userAge >= 18 && userAge <= 120;
    }
    if (step === 3) {
      return exPartnerName.trim().length > 0 && breakupTimeRange !== null;
    }
    if (relationshipMode === "relationship_separation") {
      if (step === 4) return relationshipGoal !== null;
      if (step === 5) return breakupInitiator !== null;
      return true;
    }
    if (relationshipMode === "coparenting") {
      if (step === 4) return childrenCountCategory === "one" || childrenCountCategory === "two_plus";
      if (step === 5) return custodyType !== null;
      if (step === 6) return responseStyle !== null;
      if (step === 7) return breakupInitiator !== null;
      return true;
    }
    return false;
  }

  function nextStep() {
    if (!canGoNext()) return;
    setStep((prev) => Math.min(totalSteps, prev + 1));
  }

  function prevStep() {
    setStep((prev) => Math.max(1, prev - 1));
  }

  async function submitProfile() {
    if (!canGoNext() || saving || !relationshipMode || !breakupTimeRange || !breakupInitiator) return;
    setSaving(true);
    setError(null);
    try {
      const isCoparenting = relationshipMode === "coparenting";
      await putOnboardingProfile({
        relationship_mode: relationshipMode,
        user_name: userName.trim(),
        user_age: Number(userAge),
        ex_partner_name: exPartnerName.trim(),
        ex_partner_pronoun: exPartnerPronoun,
        breakup_time_range: breakupTimeRange,
        children_count_category: isCoparenting ? childrenCountCategory : "none",
        relationship_goal: isCoparenting ? null : relationshipGoal,
        breakup_initiator: breakupInitiator,
        custody_type: isCoparenting ? custodyType : null,
        response_style: isCoparenting ? responseStyle : null,
        country_code: countryCode.toUpperCase().slice(0, 2),
        language_code: languageCode,
      });
      router.replace("/mvp");
    } catch (exc) {
      setError(toUiErrorMessage(exc, "No se pudo guardar tus datos de onboarding."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-6 text-sm text-[#64748B]">
        Cargando onboarding...
      </main>
    );
  }

  const isLastStep = step === totalSteps;
  const primaryLabel = isLastStep ? (saving ? "Guardando..." : "Guardar y continuar") : "Siguiente";

  return (
    <OnboardingWizardShell
      progress={progress}
      error={error}
      bottomAction={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={prevStep}
            disabled={step === 1 || saving}
            className="h-12 min-w-[112px] rounded-xl border border-[#CBD5E1] bg-white px-4 text-[16px] font-semibold text-[#334155] transition-colors hover:bg-[#F1F5F9] disabled:cursor-not-allowed disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={() => (isLastStep ? void submitProfile() : nextStep())}
            disabled={!canGoNext() || saving}
            className="h-12 flex-1 rounded-xl bg-[#2563EB] px-5 text-[17px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] active:bg-[#1E40AF] disabled:cursor-not-allowed disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]"
          >
            {primaryLabel}
          </button>
        </div>
      }
    >
      {step === 1 ? (
        <>
          <OnboardingStepTitle
            title="¿Cuál describe mejor tu situación actual?"
            subtitle="Esto define cómo personalizamos tus respuestas en ExReply."
          />
          <div className="space-y-3">
            {RELATIONSHIP_MODE_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                description={item.description}
                selected={relationshipMode === item.value}
                onClick={() => applyMode(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <OnboardingStepTitle title="Contanos sobre vos" subtitle="Solo usamos estos datos para personalizar el tono." />
          <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
            <label className={labelClassName}>Tu nombre</label>
            <input
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              className={inputClassName}
              placeholder="Tu nombre"
            />
            <label className={labelClassName}>Tu edad</label>
            <input
              type="number"
              min={18}
              max={120}
              value={userAge}
              onChange={(event) => {
                const value = event.target.value;
                setUserAge(value === "" ? "" : Number(value));
              }}
              className={inputClassName}
              placeholder="Edad"
            />
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <OnboardingStepTitle
            title="Contexto de separación"
            subtitle="Definimos contexto para ajustar redacción y sugerencias."
          />
          <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
            <label className={labelClassName}>Nombre de tu ex pareja</label>
            <input
              value={exPartnerName}
              onChange={(event) => setExPartnerName(event.target.value)}
              className={inputClassName}
              placeholder="Nombre"
            />
            <label className={labelClassName}>Hace cuánto se separaron</label>
            <div className="space-y-2">
              {BREAKUP_TIME_OPTIONS.map((item) => (
                <OnboardingOptionCard
                  key={item.value}
                  label={item.label}
                  selected={breakupTimeRange === item.value}
                  onClick={() => setBreakupTimeRange(item.value)}
                />
              ))}
            </div>
            <label className={labelClassName}>
              Cuando hablemos de tu ex pareja, ¿cómo querés que nos refiramos?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <OnboardingOptionCard
                label="Él"
                selected={exPartnerPronoun === "el"}
                onClick={() => setExPartnerPronoun("el")}
              />
              <OnboardingOptionCard
                label="Ella"
                selected={exPartnerPronoun === "ella"}
                onClick={() => setExPartnerPronoun("ella")}
              />
            </div>
          </div>
        </>
      ) : null}

      {relationshipMode === "relationship_separation" && step === 4 ? (
        <>
          <OnboardingStepTitle title="¿Cuál es tu objetivo?" subtitle="Seleccioná una opción predefinida." />
          <div className="space-y-3">
            {RELATIONSHIP_GOAL_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                description={item.description}
                selected={relationshipGoal === item.value}
                onClick={() => setRelationshipGoal(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {relationshipMode === "relationship_separation" && step === 5 ? (
        <>
          <OnboardingStepTitle title="¿Quién dejó a quién?" subtitle="Último paso para completar tu perfil." />
          <div className="space-y-3">
            {BREAKUP_INITIATOR_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                selected={breakupInitiator === item.value}
                onClick={() => setBreakupInitiator(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {relationshipMode === "coparenting" && step === 4 ? (
        <>
          <OnboardingStepTitle
            title="Cantidad de hijos en común"
            subtitle="Solo guardamos categoría agregada. No guardamos datos de menores."
          />
          <div className="space-y-3">
            {CHILDREN_COUNT_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                selected={childrenCountCategory === item.value}
                onClick={() => setChildrenCountCategory(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {relationshipMode === "coparenting" && step === 5 ? (
        <>
          <OnboardingStepTitle title="Tenencia" subtitle="Elegí la opción que mejor represente tu situación." />
          <div className="space-y-3">
            {CUSTODY_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                selected={custodyType === item.value}
                onClick={() => setCustodyType(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {relationshipMode === "coparenting" && step === 6 ? (
        <>
          <OnboardingStepTitle
            title="¿Cómo deseás que sean tus respuestas?"
            subtitle="Definimos estilo de comunicación para tu wizard."
          />
          <div className="space-y-3">
            {RESPONSE_STYLE_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                description={item.description}
                selected={responseStyle === item.value}
                onClick={() => setResponseStyle(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {relationshipMode === "coparenting" && step === 7 ? (
        <>
          <OnboardingStepTitle title="¿Quién dejó a quién?" subtitle="Último paso para completar tu perfil." />
          <div className="space-y-3">
            {BREAKUP_INITIATOR_OPTIONS.map((item) => (
              <OnboardingOptionCard
                key={item.value}
                label={item.label}
                selected={breakupInitiator === item.value}
                onClick={() => setBreakupInitiator(item.value)}
              />
            ))}
          </div>
        </>
      ) : null}
    </OnboardingWizardShell>
  );
}
