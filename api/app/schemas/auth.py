from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=4096)


class UserSummary(BaseModel):
    id: UUID
    email: str = Field(min_length=3, max_length=320)
    name: str | None = None
    memory_opt_in: bool = False
    locale: str | None = None
    picture_url: str | None = None
    country_code: str = "UY"
    language_code: str = "es"
    onboarding_completed: bool = False


class GoogleAuthResponse(BaseModel):
    access_token: str = Field(min_length=1)
    refresh_token: str = Field(min_length=1)
    token_type: str = "bearer"
    expires_in: int = Field(default=3600, gt=0)
    refresh_expires_in: int = Field(default=60 * 60 * 24 * 30, gt=0)
    user: UserSummary


class RefreshSessionRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)


class LogoutResponse(BaseModel):
    revoked: bool


class CurrentSessionResponse(BaseModel):
    user: UserSummary

