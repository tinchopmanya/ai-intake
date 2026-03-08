from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    conversation_id = payload.conversation_id or "new-conversation"
    return ChatResponse(
        conversation_id=conversation_id,
        answer=f"echo: {payload.message}",
    )
