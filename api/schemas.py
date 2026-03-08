from pydantic import BaseModel
from pydantic import Field


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    channel: str = "web"


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str


class Message(BaseModel):
    role: str
    message: str
    channel: str


class ConversationHistoryResponse(BaseModel):
    conversation_id: str
    messages: list[Message]


class AdvisorRequest(BaseModel):
    conversation_text: str = Field(min_length=1)
    context: str = ""
    user_id: str = "user-main"
    contact_id: str | None = None


class AdvisorResult(BaseModel):
    advisor_id: str
    advisor_name: str
    suggestions: list[str]


class AdvisorResponse(BaseModel):
    analysis: str
    results: list[AdvisorResult]
    # Temporary compatibility fields for current frontend.
    advisor_id: str | None = None
    advisor_name: str | None = None
    main_suggestion: str | None = None
    variants: list[dict[str, str]] | None = None
