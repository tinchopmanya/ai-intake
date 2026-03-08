from datetime import datetime

from pydantic import BaseModel
from pydantic import Field


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    channel: str = "web"


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str


class Message(BaseModel):
    role: str
    message: str
    channel: str


class ConversationHistoryResponse(BaseModel):
    conversation_id: str
    messages: list[Message]


class AdvisorRequest(BaseModel):
    conversation_text: str = Field(min_length=1)
    context: str = ""
    user_id: str = "user-main"
    contact_id: str | None = None
    conversation_id: str | None = None


class AdvisorResult(BaseModel):
    advisor_id: str
    advisor_name: str
    suggestions: list[str]


class ContactResolutionCandidate(BaseModel):
    contact_id: str
    contact_name: str
    match_mode: str
    confidence: float


class ContactResolutionMetadata(BaseModel):
    resolved_contact_id: str | None = None
    resolved_contact_name: str | None = None
    resolution_mode: str = "unresolved"
    candidate_contacts: list[ContactResolutionCandidate] = Field(default_factory=list)
    owner_detected_name: str | None = None
    confidence: float | None = None


class AdvisorResponse(BaseModel):
    conversation_id: str
    analysis: str
    results: list[AdvisorResult]
    contact_resolution: ContactResolutionMetadata | None = None


class AdvisorConversationHistoryResponse(BaseModel):
    conversation_id: str
    messages: list[Message]
    analysis: str | None = None
    results: list[AdvisorResult]


class AdvisorConversationSummary(BaseModel):
    conversation_id: str
    contact_id: str | None = None
    created_at: datetime
    updated_at: datetime
    analysis_preview: str | None = None
    advisors_count: int = 0


class AdvisorConversationListResponse(BaseModel):
    conversations: list[AdvisorConversationSummary]
