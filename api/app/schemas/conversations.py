from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class ConversationCreateRequest(BaseModel):
    advisor_id: str | None = Field(default=None, max_length=80)


class ConversationUpdateRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=6000)
    case_title: str | None = Field(default=None, max_length=160)
    analysis_summary: str | None = Field(default=None, max_length=1200)
    source_kind: str | None = Field(default=None, max_length=40)
    child_names: list[str] = Field(default_factory=list, max_length=5)


class ConversationSummary(BaseModel):
    id: UUID
    title: str
    title_status: str
    advisor_id: str | None = None
    created_at: datetime
    last_message_at: datetime


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]
