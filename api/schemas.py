from pydantic import BaseModel


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
    conversation_text: str
    context: str = ""
    tone: str = "empathetic"


class AdvisorVariant(BaseModel):
    tone: str
    text: str


class AdvisorResponse(BaseModel):
    analysis: str
    main_suggestion: str
    variants: list[AdvisorVariant]
