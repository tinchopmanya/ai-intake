"use client";

import Image from "next/image";

import { SystemAdvisor } from "./systemAdvisors";

type AdvisorCardProps = {
  advisor: SystemAdvisor;
  selected: boolean;
  onSelect: (advisorId: string) => void;
};

export default function AdvisorCard({
  advisor,
  selected,
  onSelect,
}: AdvisorCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(advisor.id)}
      className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
        selected
          ? "border-slate-900 ring-2 ring-slate-300"
          : "border-gray-200 hover:border-gray-300 hover:shadow"
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <Image
          src={advisor.image}
          alt={advisor.name}
          width={56}
          height={56}
          className="rounded-xl border border-gray-200 bg-gray-100"
        />
        <div>
          <p className="text-base font-semibold text-gray-900">{advisor.name}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
            {advisor.role}
          </p>
        </div>
      </div>
      <p className="text-sm leading-6 text-gray-700">{advisor.description}</p>
    </button>
  );
}
