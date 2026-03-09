"use client";

import Image from "next/image";
import { useEffect } from "react";

import { ADVISOR_NOTICE } from "@/data/advisors";
import type { AdvisorProfile } from "@/data/advisors";

type AdvisorProfileModalProps = {
  profile: AdvisorProfile | null;
  onClose: () => void;
};

export function AdvisorProfileModal({ profile, onClose }: AdvisorProfileModalProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!profile) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-gray-100 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-800">Perfil del consejero</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200/70"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center text-center">
          <Image
            src={profile.avatar256}
            alt={profile.name}
            width={256}
            height={256}
            className="h-44 w-44 rounded-2xl border border-gray-200 object-cover md:h-52 md:w-52"
          />
          <p className="mt-3 text-lg font-semibold text-gray-800">{profile.name}</p>
          <p className="text-sm text-gray-600">{profile.age} anos</p>
          <p className="mt-1 text-sm font-medium text-gray-700">{profile.role}</p>
          <p className="mt-3 text-sm leading-6 text-gray-700">{profile.description}</p>
          <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
            {ADVISOR_NOTICE}
          </p>
        </div>
      </div>
    </div>
  );
}
