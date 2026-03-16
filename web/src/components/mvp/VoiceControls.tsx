"use client";

import type { MouseEvent } from "react";

type VoiceMicButtonProps = {
  listening: boolean;
  disabled?: boolean;
  onClick: () => void;
  idleLabel: string;
  listeningLabel: string;
};

type VoiceListeningBadgeProps = {
  listening: boolean;
  label?: string;
};

type VoicePlaybackButtonProps = {
  speaking: boolean;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function VoiceMicButton({
  listening,
  disabled = false,
  onClick,
  idleLabel,
  listeningLabel,
}: VoiceMicButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60 ${
        listening
          ? "border-[#fecaca] bg-[#fff5f5] text-[#7f1d1d]"
          : "border-[#ddd] bg-white text-[#111] hover:bg-[#fafafa]"
      }`}
      aria-pressed={listening}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          listening ? "bg-[#ef4444] animate-pulse" : "bg-[#cbd5e1]"
        }`}
      />
      {listening ? listeningLabel : idleLabel}
    </button>
  );
}

export function VoiceListeningBadge({
  listening,
  label = "Escuchando...",
}: VoiceListeningBadgeProps) {
  if (!listening) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#fff5f5] px-2 py-1 text-[12px] text-[#b91c1c]">
      <span className="h-2 w-2 rounded-full bg-[#ef4444] animate-pulse" />
      {label}
    </span>
  );
}

export function VoicePlaybackButton({
  speaking,
  disabled = false,
  onClick,
}: VoicePlaybackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[13px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60 ${
        speaking
          ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
          : "border-[#ddd] bg-transparent text-[#111] hover:bg-[#fafafa]"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          speaking ? "bg-[#1d4ed8] animate-pulse" : "bg-[#94a3b8]"
        }`}
      />
      {speaking ? "Detener" : "Escuchar"}
    </button>
  );
}
