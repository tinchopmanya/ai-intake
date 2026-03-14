import { API_URL } from "@/lib/config";
import { authFetch } from "@/lib/auth/client";
import type { AdvisorRequest } from "@/lib/api/types";
import type { AdvisorResponse } from "@/lib/api/types";
import type { AnalysisRequest } from "@/lib/api/types";
import type { AnalysisResponse } from "@/lib/api/types";
import type { WizardEventRequest } from "@/lib/api/types";
import type { WizardEventResponse } from "@/lib/api/types";

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await authFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { message?: string; detail?: string }
      | null;
    throw new Error(
      errorPayload?.message || errorPayload?.detail || `HTTP ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * Executes message risk/emotion analysis.
 */
export function postAnalysis(payload: AnalysisRequest): Promise<AnalysisResponse> {
  return postJson<AnalysisResponse>("/v1/analysis", payload);
}

/**
 * Requests advisor suggestions using optional analysis context.
 */
export function postAdvisor(payload: AdvisorRequest): Promise<AdvisorResponse> {
  return postJson<AdvisorResponse>("/v1/advisor", payload);
}

/**
 * Emits wizard product events (ex: reply copied) for MVP adoption metrics.
 */
export function postWizardEvent(payload: WizardEventRequest): Promise<WizardEventResponse> {
  return postJson<WizardEventResponse>("/v1/events", payload);
}

