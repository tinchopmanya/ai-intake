"use client";

import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
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
      <div className="mb-3">
        <AdvisorAvatarItem
          name={advisor.name}
          role={advisor.role}
          avatarSrc={advisor.image}
          size={56}
        />
      </div>
      <p className="text-sm leading-6 text-gray-700">{advisor.description}</p>
    </button>
  );
}
