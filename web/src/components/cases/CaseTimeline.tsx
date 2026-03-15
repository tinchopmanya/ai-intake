"use client";

import { useEffect, useState } from "react";

import { getCaseTimeline } from "@/lib/api/client";
import type { CaseTimelineEvent } from "@/lib/api/types";

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function CaseTimeline({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<CaseTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadTimeline() {
      setLoading(true);
      setError(null);
      try {
        const payload = await getCaseTimeline(caseId);
        if (!mounted) return;
        setEvents(payload.events);
      } catch {
        if (!mounted) return;
        setError("No se pudo cargar la linea de tiempo.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadTimeline();
    return () => {
      mounted = false;
    };
  }, [caseId]);

  if (loading) {
    return <p className="text-sm text-[#475569]">Cargando timeline...</p>;
  }
  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }
  if (events.length === 0) {
    return <p className="text-sm text-[#475569]">Sin eventos registrados para este caso.</p>;
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li
          key={`${event.event_type}-${event.id}`}
          className="rounded-xl border border-[#e5e7eb] bg-white p-3"
        >
          <p className="text-xs uppercase tracking-wide text-[#64748b]">{event.event_type}</p>
          <p className="mt-1 text-sm font-medium text-[#1f2937]">{event.title}</p>
          <p className="mt-1 text-xs text-[#475569]">{formatDateTime(event.event_time)}</p>
        </li>
      ))}
    </ul>
  );
}
