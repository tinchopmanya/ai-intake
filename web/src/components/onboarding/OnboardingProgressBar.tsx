type OnboardingProgressBarProps = {
  value: number;
};

export function OnboardingProgressBar({ value }: OnboardingProgressBarProps) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#d8dee8]">
      <div
        className="h-full rounded-full bg-[#2f5bea] transition-all duration-300 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

