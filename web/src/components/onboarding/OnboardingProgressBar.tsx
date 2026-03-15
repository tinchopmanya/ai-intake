type OnboardingProgressBarProps = {
  value: number;
};

export function OnboardingProgressBar({ value }: OnboardingProgressBarProps) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
      <div
        className="h-full rounded-full bg-[#2563EB] transition-all duration-300 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

