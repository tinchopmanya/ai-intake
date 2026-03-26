from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class ConversationCreateRequest(BaseModel):
    advisor_id: str | None = Field(default=None, max_length=80)


class ConversationSummary(BaseModel):
    id: UUID
    title: str
    title_status: str
    advisor_id: str | None = None
    created_at: datetime
    last_message_at: datetime


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]
