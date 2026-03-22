"use client";

import type { MouseEvent } from "react";

type VoiceMicButtonProps = {
  listening: boolean;
  disabled?: boolean;
  onClick: () => void;
  idleLabel: string;
  listeningLabel: string;
  iconOnly?: boolean;
  ariaLabel?: string;
  className?: string;
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
  iconOnly = false,
  ariaLabel,
  className = "",
}: VoiceMicButtonProps) {
  const baseClass = iconOnly
    ? "group inline-flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.2)] disabled:cursor-not-allowed disabled:border-[#e7e7e7] disabled:bg-[#f8f8f8] disabled:text-[#9ca3af]"
    : "group inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(15,23,42,0.2)] disabled:cursor-not-allowed disabled:border-[#e7e7e7] disabled:bg-[#f8f8f8] disabled:text-[#9ca3af]";
  const stateClass = listening
    ? "border-[#f2d2d8] bg-[#fff7f8] text-[#7f1d1d] shadow-[0_1px_2px_rgba(127,29,29,0.08)]"
    : "border-[#e5e5e5] bg-white text-[#111] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-[#d7d7d7] hover:bg-[#fafafa]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${stateClass} ${className}`.trim()}
      aria-pressed={listening}
      aria-label={ariaLabel ?? (listening ? listeningLabel : idleLabel)}
      title={ariaLabel ?? (listening ? listeningLabel : idleLabel)}
    >
      {iconOnly ? (
        <>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className={`h-[18px] w-[18px] transition-colors ${
              listening ? "text-[#7f1d1d]" : "text-[#526173] group-hover:text-[#334155]"
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3.75a2.75 2.75 0 0 0-2.75 2.75v4.75a2.75 2.75 0 1 0 5.5 0V6.5A2.75 2.75 0 0 0 12 3.75Z" />
            <path d="M6.75 10.75a5.25 5.25 0 1 0 10.5 0" />
            <path d="M12 16v4.25" />
            <path d="M9.25 20.25h5.5" />
          </svg>
          <span className="sr-only">{listening ? listeningLabel : idleLabel}</span>
        </>
      ) : (
        <>
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
        </>
      )}
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
      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(26,39,68,0.25)] disabled:cursor-not-allowed disabled:opacity-60 ${
        speaking
          ? "border-[#bfd3ff] bg-[#ebf2ff] text-[#1d4ed8] shadow-[0_2px_6px_rgba(29,78,216,0.12)]"
          : "border-[#c8d6ea] bg-white text-[#334155] hover:border-[#b7c7de] hover:bg-[#f8fbff]"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          speaking ? "bg-[#1d4ed8] animate-pulse" : "bg-[#90a4c5]"
        }`}
      />
      {speaking ? "Detener" : "Escuchar"}
    </button>
  );
}
