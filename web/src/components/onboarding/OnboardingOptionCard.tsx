type OnboardingOptionCardProps = {
  label: string;
  selected: boolean;
  onClick: () => void;
  description?: string;
};

export function OnboardingOptionCard({
  label,
  selected,
  onClick,
  description,
}: OnboardingOptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border px-4 py-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(37,99,235,0.22)] ${
        selected
          ? "border-[#3B82F6] bg-[#EFF6FF] text-[#1E3A8A] shadow-[0_2px_8px_rgba(37,99,235,0.12)]"
          : "border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#CBD5E1] hover:bg-[#F8FAFC] hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
      }`}
    >
      <p className="text-[18px] font-semibold leading-6">{label}</p>
      {description ? (
        <p className={`mt-1.5 text-[15px] leading-6 ${selected ? "text-[#1E3A8A]" : "text-[#475569]"}`}>
          {description}
        </p>
      ) : null}
    </button>
  );
}

