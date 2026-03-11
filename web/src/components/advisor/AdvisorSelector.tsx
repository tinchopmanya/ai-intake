"use client";

import { useEffect, useState } from "react";

import AdvisorCard from "./AdvisorCard";
import { SYSTEM_ADVISORS } from "./systemAdvisors";

type AdvisorSelectorProps = {
  onSelectionChange: (selectedAdvisors: string[]) => void;
};

/**
 * Interactive advisor picker with a maximum of three active selections.
 */
export default function AdvisorSelector({ onSelectionChange }: AdvisorSelectorProps) {
  const [selectedAdvisors, setSelectedAdvisors] = useState<string[]>([]);

  useEffect(() => {
    onSelectionChange(selectedAdvisors);
  }, [onSelectionChange, selectedAdvisors]);

  function toggleAdvisor(advisorId: string) {
    setSelectedAdvisors((current) => {
      if (current.includes(advisorId)) {
        return current.filter((id) => id !== advisorId);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, advisorId];
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-800">
          Selecciona tus consejeros
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Puedes elegir hasta 3 perfiles para el analisis.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SYSTEM_ADVISORS.map((advisor) => (
          <AdvisorCard
            key={advisor.id}
            advisor={advisor}
            selected={selectedAdvisors.includes(advisor.id)}
            onSelect={toggleAdvisor}
          />
        ))}
      </div>
    </section>
  );
}
