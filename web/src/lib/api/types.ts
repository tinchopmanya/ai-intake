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

