from pydantic import BaseModel
from pydantic import Field


class OcrExtractResponse(BaseModel):
    extracted_text: str = Field(min_length=1)
    provider: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
