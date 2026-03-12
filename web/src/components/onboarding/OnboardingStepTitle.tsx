type OnboardingStepTitleProps = {
  title: string;
  subtitle: string;
};

export function OnboardingStepTitle({ title, subtitle }: OnboardingStepTitleProps) {
  return (
    <header className="space-y-2">
      <h1 className="text-[31px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1f2a44]">
        {title}
      </h1>
      <p className="text-[15px] leading-6 text-[#667085]">{subtitle}</p>
    </header>
  );
}

