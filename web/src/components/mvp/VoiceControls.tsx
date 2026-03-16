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
      className={`group inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.2)] disabled:cursor-not-allowed disabled:border-[#e7e7e7] disabled:bg-[#f8f8f8] disabled:text-[#9ca3af] ${
        listening
          ? "border-[#f2d2d8] bg-[#fff7f8] text-[#7f1d1d] shadow-[0_1px_2px_rgba(127,29,29,0.08)]"
          : "border-[#e5e5e5] bg-white text-[#111] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#d7d7d7] hover:bg-[#fafafa]"
      }`}
      aria-pressed={listening}
    >
      <span
        className={`relative h-2.5 w-2.5 rounded-full transition-colors ${
          listening ? "bg-[#ef4444]" : "bg-[#c5ced9] group-hover:bg-[#a8b4c3]"
        }`}
      >
        {listening ? (
          <span className="absolute inset-0 rounded-full bg-[#ef4444] opacity-70 animate-ping" />
        ) : null}
      </span>
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
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#f2d2d8] bg-[#fff7f8] px-2.5 text-[12px] font-medium text-[#b42318]">
      <span className="relative h-2.5 w-2.5 rounded-full bg-[#ef4444]">
        <span className="absolute inset-0 rounded-full bg-[#ef4444] opacity-70 animate-ping" />
      </span>
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
