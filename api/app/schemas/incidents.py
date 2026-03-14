from datetime import date
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field

IncidentType = Literal[
    "schedule_change",
    "cancellation",
    "payment_issue",
    "hostile_message",
    "documentation",
    "other",
]

IncidentSourceType = Literal["manual", "wizard", "vent", "ocr"]


class IncidentCreateRequest(BaseModel):
    case_id: UUID
    contact_id: UUID | None = None
    incident_type: IncidentType
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    source_type: IncidentSourceType = "manual"
    related_analysis_id: UUID | None = None
    related_session_id: UUID | None = None
    incident_date: date
    confirmed: bool = False


class IncidentUpdateRequest(BaseModel):
    incident_type: IncidentType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    incident_date: date | None = None
    confirmed: bool | None = None


class IncidentSummary(BaseModel):
    id: UUID
    case_id: UUID
    contact_id: UUID | None = None
    incident_type: IncidentType
    title: str
    description: str
    source_type: IncidentSourceType
    related_analysis_id: UUID | None = None
    related_session_id: UUID | None = None
    incident_date: date
    confirmed: bool
    created_at: datetime
    updated_at: datetime


class IncidentListResponse(BaseModel):
    incidents: list[IncidentSummary]
