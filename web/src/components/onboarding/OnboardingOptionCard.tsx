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
      className={`w-full rounded-2xl border px-4 py-5 text-center transition-all duration-200 ${
        selected
          ? "border-[#a79c8f] bg-[#b8afa6] text-[#2f2a25]"
          : "border-[#e3e7ee] bg-[#eceff3] text-[#1f2a44] hover:border-[#cfd6e2] hover:bg-[#e6eaf0]"
      }`}
    >
      <p className="text-base font-semibold">{label}</p>
      {description ? (
        <p className={`mt-1.5 text-sm ${selected ? "text-[#463f38]" : "text-[#667085]"}`}>
          {description}
        </p>
      ) : null}
    </button>
  );
}

