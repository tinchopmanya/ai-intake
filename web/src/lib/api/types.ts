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

export type AdvisorChatRequest = {
  advisor_id: string;
  entry_mode: "advisor_conversation" | "advisor_refine_response";
  messages: Array<{
    role: "user" | "advisor";
    content: string;
  }>;
  case_id?: string | null;
  conversation_context?: {
    user_name?: string | null;
    ex_name?: string | null;
    has_children?: boolean | null;
    relationship_type?: string | null;
    extra?: Record<string, unknown> | null;
  } | null;
  base_reply?: string | null;
  debug?: boolean;
};

export type AdvisorChatResponse = {
  message: string;
  suggested_reply: string | null;
  mode_used: "advisor_conversation" | "advisor_refine_response";
  debug?: Record<string, unknown> | null;
};

export type AdvisorVoiceRequest = {
  advisor_id: string;
  entry_mode: "advisor_conversation" | "advisor_refine_response";
  transcript: string;
  audio_blob: Blob;
  audio_mime_type?: string;
  messages: Array<{
    role: "user" | "advisor";
    content: string;
  }>;
  case_id?: string | null;
  conversation_context?: {
    user_name?: string | null;
    ex_name?: string | null;
    has_children?: boolean | null;
    relationship_type?: string | null;
    extra?: Record<string, unknown> | null;
  } | null;
  base_reply?: string | null;
  debug?: boolean;
};

export type SupportedTtsVoice =
  | "es-AR-ElenaNeural"
  | "es-MX-DaliaNeural"
  | "es-ES-AlvaroNeural"
  | "es-MX-JorgeNeural";

export type TtsVoicePreset = "female" | "male";

export type TtsStreamRequest = {
  text: string;
  voice?: SupportedTtsVoice | null;
};

export type WizardEventRequest = {
  event_name: "reply_copied" | "case_exported";
  session_id?: string | null;
  case_id?: string | null;
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

export type ConversationTitleStatus = "pending" | "fallback" | "generated";

export type ConversationSummary = {
  id: string;
  title: string;
  title_status: ConversationTitleStatus;
  advisor_id: string | null;
  created_at: string;
  last_message_at: string;
};

export type ConversationCreateRequest = {
  advisor_id?: string | null;
};

export type ConversationUpdateRequest = {
  source_text: string;
  case_title?: string | null;
  analysis_summary?: string | null;
};

export type ConversationListResponse = {
  conversations: ConversationSummary[];
};

export type MessageRole = "user" | "system" | "assistant";
export type MessageType = "source_text" | "analysis_action" | "selected_reply";

export type MessageCreateRequest = {
  conversation_id: string;
  role: MessageRole;
  content: string;
  message_type: MessageType;
};

export type MessageSummary = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  message_type: MessageType;
  created_at: string;
};

export type MessageListResponse = {
  messages: MessageSummary[];
};

export type EmotionalCheckinSummary = {
  id: string;
  created_at: string;
  mood_level: number;
  confidence_level: number;
  recent_contact: boolean;
  vinculo_expareja: number | null;
  interaccion_hijos: number | null;
};

export type EmotionalCheckinCreateRequest = {
  mood_level: number;
  confidence_level: number;
  recent_contact: boolean;
  vinculo_expareja: number | null;
  interaccion_hijos?: number | null;
};

export type EmotionalCheckinTodayResponse = {
  has_checkin_today: boolean;
  today_checkin: EmotionalCheckinSummary | null;
};

export type EmotionalHistoryDeleteResponse = {
  emotional_checkins_deleted: number;
  memory_items_deleted: number;
};

export type MemoryType = "mood_checkin" | "advisor_session_summary" | "coparenting_exchange_summary";
export type MemorySourceKind = "advisor" | "ex_chat_capture" | "ex_chat_pasted" | "draft_analysis" | "checkin";

export type MemoryItemSummary = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  memory_type: MemoryType;
  safe_title: string;
  safe_summary: string;
  tone: string | null;
  risk_level: string | null;
  recommended_next_step: string | null;
  source_kind: MemorySourceKind;
  is_sensitive: boolean;
  source_reference_id: string | null;
  memory_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryItemListResponse = {
  items: MemoryItemSummary[];
};

export type MemoryAggregateBucket = {
  label: string;
  count: number;
};

export type ExPartnerHistoricalReportResponse = {
  total_items: number;
  predominant_tone: string | null;
  predominant_risk_level: string | null;
  frequent_topics: MemoryAggregateBucket[];
  recurring_recommendations: MemoryAggregateBucket[];
  global_summary: string;
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
  conversation_turns?: Array<{
    speaker: "me" | "them";
    text: string;
    time?: string | null;
  }> | null;
  raw_text?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type OcrCapabilitiesResponse = {
  available: boolean;
  selected_provider: string;
  providers_checked: string[];
  reason_codes: string[];
};

export type OcrInterpretRequest = {
  text: string;
  source: "ocr" | "text";
};

export type OcrInterpretResponse = {
  blocks: Array<{
    id: string;
    speaker: "ex_partner" | "user" | "unknown";
    content: string;
    confidence?: number | null;
  }>;
  method: "gemini" | "heuristic";
  warnings: string[];
  conversation_turns?: Array<{
    speaker: "me" | "them";
    text: string;
    time?: string | null;
  }> | null;
};

export type BreakupTimeRange = "lt_2m" | "between_2m_1y" | "between_1y_3y" | "gt_3y";
export type RelationshipMode = "coparenting" | "relationship_separation";
export type ChildrenCountCategory = "none" | "one" | "two_plus";
export type RelationshipGoal = "emotional_recovery" | "friendly_close" | "open_reconciliation";
export type BreakupInitiator = "mutual" | "partner" | "me";
export type CustodyType =
  | "partner_custody_visits"
  | "shared_custody"
  | "my_custody_partner_visits"
  | "undefined";
export type ResponseStyle =
  | "strict_parental"
  | "cordial_collaborative"
  | "friendly_close"
  | "open_reconciliation";
export type ExPartnerPronoun = "el" | "ella";

export type OnboardingProfile = {
  relationship_mode: RelationshipMode | null;
  user_name: string | null;
  user_age: number | null;
  ex_partner_name: string | null;
  ex_partner_pronoun: ExPartnerPronoun | null;
  breakup_time_range: BreakupTimeRange | null;
  children_count_category: ChildrenCountCategory | null;
  relationship_goal: RelationshipGoal | null;
  breakup_initiator: BreakupInitiator | null;
  custody_type: CustodyType | null;
  response_style: ResponseStyle | null;
  country_code: string;
  language_code: "es" | "en" | "pt";
  onboarding_completed: boolean;
};

export type OnboardingProfileUpdateRequest = {
  relationship_mode: RelationshipMode;
  user_name: string;
  user_age: number;
  ex_partner_name: string;
  ex_partner_pronoun: ExPartnerPronoun;
  breakup_time_range: BreakupTimeRange;
  children_count_category: ChildrenCountCategory;
  relationship_goal?: RelationshipGoal | null;
  breakup_initiator: BreakupInitiator;
  custody_type?: CustodyType | null;
  response_style?: ResponseStyle | null;
  country_code: string;
  language_code: "es" | "en" | "pt";
};

