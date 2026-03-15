type OnboardingStepTitleProps = {
  title: string;
  subtitle: string;
};

export function OnboardingStepTitle({ title, subtitle }: OnboardingStepTitleProps) {
  return (
    <header className="space-y-2">
      <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-[#0F172A] sm:text-[40px]">
        {title}
      </h1>
      <p className="text-[17px] leading-7 text-[#475569]">{subtitle}</p>
    </header>
  );
}

