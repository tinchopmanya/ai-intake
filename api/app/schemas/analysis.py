from datetime import datetime
from typing import Any
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator

UsageMode = Literal["reactive", "preventive"]
RelationshipType = Literal["pareja", "familia", "amistad", "trabajo", "cliente", "otro"]
EmotionLabel = Literal["neutral", "calm", "empathetic", "assertive", "friendly", "apologetic"]


class AnalysisRequest(BaseModel):
    message_text: str = Field(min_length=1, max_length=8000)
    mode: UsageMode
    relationship_type: RelationshipType
    contact_id: UUID | None = None
    quick_mode: bool = False
    context: dict[str, Any] | None = None

    @field_validator("message_text")
    @classmethod
    def validate_message_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message_text cannot be blank")
        return normalized


class AnalysisResponse(BaseModel):
    analysis_id: UUID
    summary: str
    risk_flags: list[str] = Field(default_factory=list)
    tone_detected: str | None = None
    suggested_emotion_label: EmotionLabel | None = None
    analysis_skipped: bool = False
    created_at: datetime

