from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from uuid import uuid4

from config import settings

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


conversations: dict[str, list[Message]] = {}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    conversation_id = payload.conversation_id or str(uuid4())
    answer = f"echo: {payload.message}"

    history = conversations.setdefault(conversation_id, [])
    history.append(
        Message(
            role="user",
            message=payload.message,
            channel=payload.channel,
        )
    )
    history.append(
        Message(
            role="assistant",
            message=answer,
            channel="assistant",
        )
    )

    return ChatResponse(
        conversation_id=conversation_id,
        answer=answer,
    )


@app.get(
    "/v1/conversations/{conversation_id}",
    response_model=ConversationHistoryResponse,
)
def get_conversation_history(conversation_id: str) -> ConversationHistoryResponse:
    if conversation_id not in conversations:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return ConversationHistoryResponse(
        conversation_id=conversation_id,
        messages=conversations[conversation_id],
    )
