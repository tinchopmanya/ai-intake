from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class EmotionalCheckinCreateRequest(BaseModel):
    mood_level: int = Field(ge=0, le=4)
    confidence_level: int = Field(ge=0, le=4)
    recent_contact: bool
    vinculo_expareja: int | None = Field(default=None, ge=1, le=5)
    interaccion_hijos: int | None = Field(default=None, ge=1, le=5)


class EmotionalCheckinSummary(BaseModel):
    id: UUID
    created_at: datetime
    mood_level: int
    confidence_level: int
    recent_contact: bool
    vinculo_expareja: int | None = None
    interaccion_hijos: int | None = None


class EmotionalCheckinTodayStatusResponse(BaseModel):
    has_checkin_today: bool
    today_checkin: EmotionalCheckinSummary | None = None


class EmotionalHistoryDeleteResponse(BaseModel):
    emotional_checkins_deleted: int
    memory_items_deleted: int
