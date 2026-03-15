from typing import Literal

from pydantic import BaseModel
from pydantic import Field


class OcrConversationTurn(BaseModel):
    speaker: str = Field(pattern="^(me|them)$")
    text: str = Field(min_length=1)
    time: str | None = None


class OcrExtractResponse(BaseModel):
    extracted_text: str = Field(min_length=1)
    provider: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    conversation_turns: list[OcrConversationTurn] | None = None
    raw_text: str | None = None
    metadata: dict[str, object] | None = None


class OcrCapabilitiesResponse(BaseModel):
    available: bool
    selected_provider: str
    providers_checked: list[str] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)


class OcrInterpretRequest(BaseModel):
    text: str = Field(min_length=1)
    source: Literal["ocr", "text"] = "ocr"


class OcrConversationBlock(BaseModel):
    id: str = Field(min_length=1)
    speaker: Literal["ex_partner", "user"]
    content: str = Field(min_length=1)
    confidence: float | None = Field(default=None, ge=0, le=1)


class OcrInterpretResponse(BaseModel):
    blocks: list[OcrConversationBlock] = Field(default_factory=list)
    method: Literal["gemini", "heuristic"]
    warnings: list[str] = Field(default_factory=list)
    conversation_turns: list[OcrConversationTurn] | None = None
