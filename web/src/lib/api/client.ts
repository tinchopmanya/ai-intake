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
import type { ConversationUpdateRequest } from "@/lib/api/types";
import type { EmotionalCheckinCreateRequest } from "@/lib/api/types";
import type { EmotionalHistoryDeleteResponse } from "@/lib/api/types";
import type { EmotionalCheckinSummary } from "@/lib/api/types";
import type { EmotionalCheckinTodayResponse } from "@/lib/api/types";
import type { ExPartnerHistoricalReportResponse } from "@/lib/api/types";
import type { IncidentCreateRequest } from "@/lib/api/types";
import type { IncidentListResponse } from "@/lib/api/types";
import type { IncidentSummary } from "@/lib/api/types";
import type { IncidentUpdateRequest } from "@/lib/api/types";
import type { MemoryItemListResponse } from "@/lib/api/types";
import type { MemorySourceKind } from "@/lib/api/types";
import type { MemoryType } from "@/lib/api/types";
import type { MessageCreateRequest } from "@/lib/api/types";
import type { MessageListResponse } from "@/lib/api/types";
import type { MessageSummary } from "@/lib/api/types";
import type { OnboardingProfile } from "@/lib/api/types";
import type { OnboardingProfileUpdateRequest } from "@/lib/api/types";
import type { OcrInterpretRequest } from "@/lib/api/types";
import type { OcrInterpretResponse } from "@/lib/api/types";
import type { TtsStreamRequest } from "@/lib/api/types";
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
        errorPayload?.detail ||
        errorPayload?.message ||
        `http_${response.status}`,
    );
  }

  return (await response.json()) as T;
}

function isNetworkUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const normalized = error.message.trim().toLowerCase();
  return normalized === "network_unavailable" || normalized === "no se pudo conectar con el backend.";
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

async function deleteJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, {
    method: "DELETE",
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

export async function postTtsStream(payload: TtsStreamRequest, options?: { signal?: AbortSignal }): Promise<Response> {
  const response = await authFetch(`${API_URL}/v1/tts/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { error_code?: string; message?: string; detail?: string }
      | null;
    throw new Error(
      errorPayload?.error_code ||
        errorPayload?.detail ||
        errorPayload?.message ||
        `http_${response.status}`,
    );
  }

  return response;
}

export async function postTtsAudio(payload: TtsStreamRequest, options?: { signal?: AbortSignal }): Promise<Blob> {
  const response = await authFetch(`${API_URL}/v1/tts/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { error_code?: string; message?: string; detail?: string }
      | null;
    throw new Error(
      errorPayload?.error_code ||
        errorPayload?.detail ||
        errorPayload?.message ||
        `http_${response.status}`,
    );
  }

  return await response.blob();
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

export function patchConversation(
  conversationId: string,
  payload: ConversationUpdateRequest,
): Promise<ConversationSummary> {
  return patchJson<ConversationSummary>(`/v1/conversations/${conversationId}`, payload);
}

export function getEmotionalCheckinToday(): Promise<EmotionalCheckinTodayResponse> {
  return getJson<EmotionalCheckinTodayResponse>("/v1/emotional-checkins/today").catch((error) => {
    if (isNetworkUnavailableError(error)) {
      return {
        has_checkin_today: false,
        today_checkin: null,
      };
    }
    throw error;
  });
}

export function postEmotionalCheckin(payload: EmotionalCheckinCreateRequest): Promise<EmotionalCheckinSummary> {
  return postJson<EmotionalCheckinSummary>("/v1/emotional-checkins", payload);
}

export function deleteEmotionalHistory(): Promise<EmotionalHistoryDeleteResponse> {
  return deleteJson<EmotionalHistoryDeleteResponse>("/v1/memory-items/history");
}

export function postMessage(payload: MessageCreateRequest): Promise<MessageSummary> {
  return postJson<MessageSummary>("/v1/messages", payload);
}

export function getConversationMessages(conversationId: string): Promise<MessageListResponse> {
  return getJson<MessageListResponse>(`/v1/conversations/${conversationId}/messages`);
}

export function getMemoryItems(params?: {
  memory_type?: MemoryType;
  source_kind?: MemorySourceKind;
  limit?: number;
  offset?: number;
}): Promise<MemoryItemListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.memory_type) {
    searchParams.set("memory_type", params.memory_type);
  }
  if (params?.source_kind) {
    searchParams.set("source_kind", params.source_kind);
  }
  if (typeof params?.limit === "number") {
    searchParams.set("limit", String(params.limit));
  }
  if (typeof params?.offset === "number") {
    searchParams.set("offset", String(params.offset));
  }
  const suffix = searchParams.toString();
  return getJson<MemoryItemListResponse>(`/v1/memory-items${suffix ? `?${suffix}` : ""}`);
}

export function getExPartnerHistoricalReport(): Promise<ExPartnerHistoricalReportResponse> {
  return getJson<ExPartnerHistoricalReportResponse>("/v1/memory-items/report/ex-partner");
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

