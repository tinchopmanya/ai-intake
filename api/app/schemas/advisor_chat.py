from __future__ import annotations

from typing import Any
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator


class AdvisorChatMessage(BaseModel):
    role: Literal["user", "advisor"]
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("content cannot be blank")
        return normalized


class AdvisorChatConversationContext(BaseModel):
    user_name: str | None = Field(default=None, max_length=120)
    ex_name: str | None = Field(default=None, max_length=120)
    has_children: bool | None = None
    relationship_type: str | None = Field(default=None, max_length=80)
    extra: dict[str, Any] | None = None


class AdvisorChatRequest(BaseModel):
    advisor_id: str = Field(min_length=1, max_length=60)
    entry_mode: Literal["advisor_conversation", "advisor_refine_response"] = "advisor_conversation"
    messages: list[AdvisorChatMessage] = Field(min_length=1, max_length=40)
    case_id: UUID | None = None
    conversation_context: AdvisorChatConversationContext | None = None
    base_reply: str | None = Field(default=None, max_length=4000)
    debug: bool = False

    @field_validator("advisor_id")
    @classmethod
    def normalize_advisor_id(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("advisor_id cannot be blank")
        return normalized


class AdvisorChatResponse(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    suggested_reply: str | None = Field(default=None, max_length=4000)
    mode_used: Literal["advisor_conversation", "advisor_refine_response"]
    debug: dict[str, Any] | None = None

