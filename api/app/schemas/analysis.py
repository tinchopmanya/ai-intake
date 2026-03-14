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
RiskSeverity = Literal["low", "medium", "high"]
AlertLevel = Literal["info", "warning", "critical"]


class AnalysisRequest(BaseModel):
    message_text: str = Field(min_length=1, max_length=8000)
    mode: UsageMode
    relationship_type: RelationshipType
    case_id: UUID | None = None
    contact_id: UUID | None = None
    source_type: Literal["text", "ocr"] = "text"
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
    class RiskFlag(BaseModel):
        code: str
        severity: RiskSeverity
        confidence: float = Field(ge=0, le=1)
        evidence: list[str] = Field(default_factory=list)

    class EmotionalContext(BaseModel):
        tone: str
        intent_guess: str

    class UiAlert(BaseModel):
        level: AlertLevel
        message: str

    analysis_id: UUID
    summary: str
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    emotional_context: EmotionalContext
    ui_alerts: list[UiAlert] = Field(default_factory=list)
    tone_detected: str | None = None
    suggested_emotion_label: EmotionLabel | None = None
    analysis_skipped: bool = False
    created_at: datetime

