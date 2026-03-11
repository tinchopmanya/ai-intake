from pydantic import BaseModel
from pydantic import Field


class OnboardingProfileResponse(BaseModel):
    objective: str | None = None
    has_children: bool | None = None
    breakup_side: str | None = None
    country_code: str
    language_code: str
    onboarding_completed: bool


class OnboardingProfileUpdateRequest(BaseModel):
    objective: str = Field(min_length=1, max_length=2000)
    has_children: bool
    breakup_side: str = Field(pattern="^(yo|mi_ex|mutuo)$")
    country_code: str = Field(min_length=2, max_length=2)
    language_code: str = Field(pattern="^(es|en|pt)$")
