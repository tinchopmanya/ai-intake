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
    user_id: str = "user-main"
    contact_id: str | None = None
    advisor_id: str | None = None


class AdvisorVariant(BaseModel):
    tone: str
    text: str


class AdvisorResponse(BaseModel):
    advisor_id: str
    advisor_name: str
    analysis: str
    main_suggestion: str
    variants: list[AdvisorVariant]
