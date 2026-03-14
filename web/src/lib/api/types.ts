export type UsageMode = "reactive" | "preventive";
export type RelationshipType =
  | "pareja"
  | "familia"
  | "amistad"
  | "trabajo"
  | "cliente"
  | "otro";

export type EmotionLabel =
  | "neutral"
  | "calm"
  | "empathetic"
  | "assertive"
  | "friendly"
  | "apologetic";

export type AnalysisRequest = {
  message_text: string;
  mode: UsageMode;
  relationship_type: RelationshipType;
  case_id?: string | null;
  contact_id?: string | null;
  source_type?: "text" | "ocr";
  quick_mode?: boolean;
  context?: Record<string, unknown> | null;
};

export type AnalysisRiskFlag = {
  code: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  evidence: string[];
};

export type AnalysisResponse = {
  analysis_id: string;
  summary: string;
  risk_flags: AnalysisRiskFlag[];
  emotional_context: {
    tone: string;
    intent_guess: string;
  };
  ui_alerts: Array<{
    level: "info" | "warning" | "critical";
    message: string;
  }>;
  tone_detected: string | null;
  suggested_emotion_label: EmotionLabel | null;
  analysis_skipped: boolean;
  created_at: string;
};

export type AdvisorRequest = {
  message_text: string;
  mode: UsageMode;
  relationship_type: RelationshipType;
  case_id?: string | null;
  contact_id?: string | null;
  source_type?: "text" | "ocr";
  quick_mode?: boolean;
  save_session?: boolean;
  analysis_id?: string | null;
  prompt_version?: string | null;
  context?: Record<string, unknown> | null;
};

export type WizardEventRequest = {
  event_name: "reply_copied";
  session_id: string;
  analysis_id?: string | null;
  advisor_id?: string | null;
  response_index?: number | null;
};

export type WizardEventResponse = {
  accepted: boolean;
  persisted: boolean;
};

export type CaseSummary = {
  id: string;
  title: string;
  contact_name: string | null;
  relationship_type: RelationshipType | null;
  summary: string;
  contact_id: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
};

export type CaseCreateRequest = {
  title: string;
  contact_name?: string | null;
  relationship_type?: RelationshipType | null;
  summary?: string | null;
  contact_id?: string | null;
};

export type CaseUpdateRequest = {
  title?: string | null;
  contact_name?: string | null;
  relationship_type?: RelationshipType | null;
  summary?: string | null;
  contact_id?: string | null;
};

export type CaseListResponse = {
  cases: CaseSummary[];
};

export type IncidentType =
  | "schedule_change"
  | "cancellation"
  | "payment_issue"
  | "hostile_message"
  | "documentation"
  | "other";

export type IncidentSourceType = "manual" | "wizard" | "vent" | "ocr";

export type IncidentSummary = {
  id: string;
  case_id: string;
  contact_id: string | null;
  incident_type: IncidentType;
  title: string;
  description: string;
  source_type: IncidentSourceType;
  related_analysis_id: string | null;
  related_session_id: string | null;
  incident_date: string;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
};

export type IncidentCreateRequest = {
  case_id: string;
  contact_id?: string | null;
  incident_type: IncidentType;
  title: string;
  description?: string;
  source_type?: IncidentSourceType;
  related_analysis_id?: string | null;
  related_session_id?: string | null;
  incident_date: string;
  confirmed?: boolean;
};

export type IncidentUpdateRequest = {
  incident_type?: IncidentType;
  title?: string;
  description?: string;
  incident_date?: string;
  confirmed?: boolean;
};

export type IncidentListResponse = {
  incidents: IncidentSummary[];
};

export type AdvisorResponse = {
  session_id: string;
  mode: UsageMode;
  quick_mode: boolean;
  analysis: {
    summary: string;
    risk_flags: string[];
  } | null;
  responses: Array<{
    text: string;
    emotion_label: EmotionLabel;
  }>;
  persistence: {
    save_session: boolean;
    zero_retention_applied: boolean;
    outputs_persisted: boolean;
    memory_persisted: boolean;
  };
  created_at: string;
};

export type OcrExtractResponse = {
  extracted_text: string;
  provider: string;
  confidence: number | null;
  warnings: string[];
};

export type OcrCapabilitiesResponse = {
  available: boolean;
  selected_provider: string;
  providers_checked: string[];
  reason_codes: string[];
};

