from pydantic import BaseModel

from assistant_profiles import DEFAULT_ASSISTANT_PROFILE


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    channel: str = "web"
    assistant_profile: str = DEFAULT_ASSISTANT_PROFILE


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
