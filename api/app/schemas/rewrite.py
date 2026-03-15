from typing import Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator


RelationshipMode = Literal["coparenting", "relationship_separation"]
RewriteStyle = Literal[
    "estrictamente_parental",
    "cordial_colaborativo",
    "amistoso_cercano",
    "abierto_reconciliacion",
    "strict_parental",
    "cordial_collaborative",
    "friendly_close",
    "open_reconciliation",
]
RewriteOptionStyle = Literal["neutral", "calm", "firm"]


class SafeRewriteRequest(BaseModel):
    relationship_mode: RelationshipMode
    response_style: RewriteStyle
    original_message: str = Field(min_length=1, max_length=8000)
    options_count: int = Field(default=3, ge=2, le=3)

    @field_validator("original_message")
    @classmethod
    def validate_original_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("original_message_blank")
        return normalized


class SafeRewriteOption(BaseModel):
    style: RewriteOptionStyle
    text: str = Field(min_length=1, max_length=1200)


class SafeRewriteResponse(BaseModel):
    responses: list[SafeRewriteOption]
