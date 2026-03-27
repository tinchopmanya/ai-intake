from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


MessageRole = Literal["user", "system", "assistant"]
MessageType = Literal["source_text", "analysis_action", "selected_reply"]


class MessageCreateRequest(BaseModel):
    conversation_id: UUID
    role: MessageRole
    content: str = Field(min_length=1, max_length=12000)
    message_type: MessageType


class MessageSummary(BaseModel):
    id: UUID
    conversation_id: UUID
    role: MessageRole
    content: str
    message_type: MessageType
    created_at: datetime


class MessageListResponse(BaseModel):
    messages: list[MessageSummary]
