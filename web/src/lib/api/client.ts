import { API_URL } from "@/lib/config";
import { authFetch } from "@/lib/auth/client";
import type { AdvisorRequest } from "@/lib/api/types";
import type { AdvisorChatRequest } from "@/lib/api/types";
import type { AdvisorChatResponse } from "@/lib/api/types";
import type { AdvisorVoiceRequest } from "@/lib/api/types";
import type { AdvisorResponse } from "@/lib/api/types";
import type { AnalysisRequest } from "@/lib/api/types";
import type { AnalysisResponse } from "@/lib/api/types";
import type { CaseCreateRequest } from "@/lib/api/types";
import type { CaseListResponse } from "@/lib/api/types";
import type { CaseSummary } from "@/lib/api/types";
import type { CaseUpdateRequest } from "@/lib/api/types";
import type { ConversationCreateRequest } from "@/lib/api/types";
import type { ConversationListResponse } from "@/lib/api/types";
import type { ConversationSummary } from "@/lib/api/types";
import type { IncidentCreateRequest } from "@/lib/api/types";
import type { IncidentListResponse } from "@/lib/api/types";
import type { IncidentSummary } from "@/lib/api/types";
import type { IncidentUpdateRequest } from "@/lib/api/types";
import type { OnboardingProfile } from "@/lib/api/types";
import type { OnboardingProfileUpdateRequest } from "@/lib/api/types";
import type { OcrInterpretRequest } from "@/lib/api/types";
import type { OcrInterpretResponse } from "@/lib/api/types";
import type { WizardEventRequest } from "@/lib/api/types";
import type { WizardEventResponse } from "@/lib/api/types";

async function requestJson<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await authFetch(`${API_URL}${path}`, init);

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { error_code?: string; message?: string; detail?: string }
      | null;
    throw new Error(
      errorPayload?.error_code ||
        errorPayload?.message ||
        errorPayload?.detail ||
        `http_${response.status}`,
    );
  }

  return (await response.json()) as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function patchJson<T>(path: string, payload: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, {
    method: "GET",
    cache: "no-store",
  });
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

export function postAdvisorChat(payload: AdvisorChatRequest): Promise<AdvisorChatResponse> {
  return postJson<AdvisorChatResponse>("/v1/advisor/chat", payload);
}

export async function postAdvisorVoice(payload: AdvisorVoiceRequest): Promise<AdvisorChatResponse> {
  const formData = new FormData();
  formData.append("advisor_id", payload.advisor_id);
  formData.append("entry_mode", payload.entry_mode);
  formData.append("transcript", payload.transcript);
  formData.append("messages_json", JSON.stringify(payload.messages));
  if (payload.case_id) {
    formData.append("case_id", payload.case_id);
  }
  if (payload.conversation_context) {
    formData.append("conversation_context_json", JSON.stringify(payload.conversation_context));
  }
  if (payload.base_reply) {
    formData.append("base_reply", payload.base_reply);
  }
  if (payload.debug) {
    formData.append("debug", "true");
  }
  const extension = payload.audio_mime_type?.includes("ogg")
    ? "ogg"
    : payload.audio_mime_type?.includes("mp4")
      ? "m4a"
      : "webm";
  formData.append("audio", payload.audio_blob, `voice-input.${extension}`);

  return requestJson<AdvisorChatResponse>("/v1/advisor/voice", {
    method: "POST",
    body: formData,
  });
}

/**
 * Emits wizard product events (ex: reply copied) for MVP adoption metrics.
 */
export function postWizardEvent(payload: WizardEventRequest): Promise<WizardEventResponse> {
  return postJson<WizardEventResponse>("/v1/events", payload);
}

export function postCase(payload: CaseCreateRequest): Promise<CaseSummary> {
  return postJson<CaseSummary>("/v1/cases", payload);
}

export function getCases(): Promise<CaseListResponse> {
  return getJson<CaseListResponse>("/v1/cases");
}

export function getCaseById(caseId: string): Promise<CaseSummary> {
  return getJson<CaseSummary>(`/v1/cases/${caseId}`);
}

export function patchCase(caseId: string, payload: CaseUpdateRequest): Promise<CaseSummary> {
  return patchJson<CaseSummary>(`/v1/cases/${caseId}`, payload);
}

export function getConversations(): Promise<ConversationListResponse> {
  return getJson<ConversationListResponse>("/v1/conversations");
}

export function postConversation(payload: ConversationCreateRequest = {}): Promise<ConversationSummary> {
  return postJson<ConversationSummary>("/v1/conversations", payload);
}

export function postIncident(payload: IncidentCreateRequest): Promise<IncidentSummary> {
  return postJson<IncidentSummary>("/v1/incidents", payload);
}

export function getIncidents(caseId?: string): Promise<IncidentListResponse> {
  const suffix = caseId ? `?case_id=${encodeURIComponent(caseId)}` : "";
  return getJson<IncidentListResponse>(`/v1/incidents${suffix}`);
}

export function patchIncident(
  incidentId: string,
  payload: IncidentUpdateRequest,
): Promise<IncidentSummary> {
  return patchJson<IncidentSummary>(`/v1/incidents/${incidentId}`, payload);
}

export function getOnboardingProfile(): Promise<OnboardingProfile> {
  return getJson<OnboardingProfile>("/v1/onboarding/profile");
}

export function putOnboardingProfile(
  payload: OnboardingProfileUpdateRequest,
): Promise<OnboardingProfile> {
  return requestJson<OnboardingProfile>("/v1/onboarding/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function postOcrInterpret(payload: OcrInterpretRequest): Promise<OcrInterpretResponse> {
  return postJson<OcrInterpretResponse>("/v1/ocr/interpret", payload);
}

