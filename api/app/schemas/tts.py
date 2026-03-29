from pydantic import BaseModel
from pydantic import Field


class TtsStreamRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    voice: str | None = Field(default=None, max_length=64)
