import { API_URL } from "@/lib/config";
import { authFetch } from "@/lib/auth/client";
import type { AdvisorRequest } from "@/lib/api/types";
import type { AdvisorResponse } from "@/lib/api/types";
import type { AnalysisRequest } from "@/lib/api/types";
import type { AnalysisResponse } from "@/lib/api/types";

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await authFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
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

