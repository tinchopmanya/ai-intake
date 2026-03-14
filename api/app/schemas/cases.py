from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field

from .analysis import RelationshipType


class CaseCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    contact_name: str | None = Field(default=None, max_length=120)
    relationship_type: RelationshipType | None = None
    summary: str | None = Field(default=None, max_length=2000)
    contact_id: UUID | None = None


class CaseUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    contact_name: str | None = Field(default=None, max_length=120)
    relationship_type: RelationshipType | None = None
    summary: str | None = Field(default=None, max_length=2000)
    contact_id: UUID | None = None


class CaseSummary(BaseModel):
    id: UUID
    title: str
    contact_name: str | None = None
    relationship_type: RelationshipType | None = None
    summary: str
    contact_id: UUID | None = None
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime


class CaseListResponse(BaseModel):
    cases: list[CaseSummary]
