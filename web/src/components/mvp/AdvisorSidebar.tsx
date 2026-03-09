"use client";

import { useState } from "react";

import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import { Panel } from "@/components/mvp/ui";
import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
import { ADVISOR_PROFILES } from "@/data/advisors";
import type { AdvisorProfile } from "@/data/advisors";

export function AdvisorSidebar() {
  const [selectedProfile, setSelectedProfile] = useState<AdvisorProfile | null>(null);

  return (
    <>
      <Panel className="h-fit p-2.5 lg:sticky lg:top-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          Advisors
        </h2>
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
          {ADVISOR_PROFILES.map((advisor) => (
            <article
              key={advisor.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-1.5 text-center transition hover:border-gray-300 hover:bg-gray-100"
            >
              <AdvisorAvatarItem
                name={advisor.name}
                role={advisor.role}
                avatarSrc={advisor.avatar64}
                size={64}
                align="center"
                onClick={() => setSelectedProfile(advisor)}
              />
            </article>
          ))}
        </div>
      </Panel>
      <AdvisorProfileModal
        profile={selectedProfile}
        onClose={() => setSelectedProfile(null)}
      />
    </>
  );
}
