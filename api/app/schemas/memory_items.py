from datetime import datetime
from typing import Any
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


MemoryType = Literal["mood_checkin", "advisor_session_summary", "coparenting_exchange_summary"]
MemorySourceKind = Literal["advisor", "ex_chat_capture", "ex_chat_pasted", "draft_analysis", "checkin"]


class MemoryItemSummary(BaseModel):
    id: UUID
    user_id: UUID
    conversation_id: UUID | None = None
    memory_type: MemoryType
    safe_title: str
    safe_summary: str
    tone: str | None = None
    risk_level: str | None = None
    recommended_next_step: str | None = None
    source_kind: MemorySourceKind
    is_sensitive: bool = False
    source_reference_id: UUID | None = None
    memory_metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class MemoryItemListResponse(BaseModel):
    items: list[MemoryItemSummary]


class MemoryAggregateBucket(BaseModel):
    label: str
    count: int


class ExPartnerHistoricalReportResponse(BaseModel):
    total_items: int
    predominant_tone: str | None = None
    predominant_risk_level: str | None = None
    frequent_topics: list[MemoryAggregateBucket] = Field(default_factory=list)
    recurring_recommendations: list[MemoryAggregateBucket] = Field(default_factory=list)
    global_summary: str
