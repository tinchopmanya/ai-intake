from datetime import datetime
from typing import Any
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator

from .analysis import EmotionLabel
from .analysis import RelationshipType
from .analysis import UsageMode


class AnalysisSnapshot(BaseModel):
    summary: str
    risk_flags: list[str] = Field(default_factory=list)


class SuggestedResponse(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    emotion_label: EmotionLabel


class PersistenceMetadata(BaseModel):
    save_session: bool = False
    zero_retention_applied: bool = True
    outputs_persisted: bool = False
    memory_persisted: bool = False


class AdvisorRequest(BaseModel):
    message_text: str = Field(min_length=1, max_length=8000)
    mode: UsageMode
    relationship_type: RelationshipType
    case_id: UUID | None = None
    contact_id: UUID | None = None
    source_type: Literal["text", "ocr"] = "text"
    quick_mode: bool = False
    save_session: bool = False
    analysis_id: UUID | None = None
    prompt_version: str | None = Field(default=None, max_length=100)
    context: dict[str, Any] | None = None

    @field_validator("message_text")
    @classmethod
    def validate_message_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message_text cannot be blank")
        return normalized


class AdvisorResponse(BaseModel):
    session_id: UUID
    mode: UsageMode
    quick_mode: bool
    analysis: AnalysisSnapshot | None = None
    responses: list[SuggestedResponse]
    persistence: PersistenceMetadata
    created_at: datetime

