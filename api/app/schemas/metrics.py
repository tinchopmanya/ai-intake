from pydantic import BaseModel
from pydantic import Field


class MvpMetricsResponse(BaseModel):
    users_logged_in: int = Field(ge=0)
    users_completed_onboarding: int = Field(ge=0)
    wizard_sessions_created: int = Field(ge=0)
    replies_generated: int = Field(ge=0)
    replies_copied: int = Field(ge=0)
    reply_adoption_rate: float = Field(ge=0.0)
    cases_created: int = Field(ge=0)
    incidents_created: int = Field(ge=0)
    case_exports: int = Field(ge=0)
    returning_users_7d: int = Field(ge=0)
