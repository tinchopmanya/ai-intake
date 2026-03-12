type OnboardingBottomActionProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

export function OnboardingBottomAction({
  label,
  disabled = false,
  onClick,
}: OnboardingBottomActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-2xl px-5 py-4 text-base font-semibold transition-colors ${
        disabled
          ? "bg-[#dde3ec] text-[#9aa5b4]"
          : "bg-[#2f5bea] text-white hover:bg-[#264bcf]"
      }`}
    >
      {label}
    </button>
  );
}

