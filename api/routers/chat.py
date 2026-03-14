from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Response

from providers.factory import build_provider
from repositories.in_memory import conversation_repository
from schemas import ChatRequest
from schemas import ChatResponse
from schemas import ConversationHistoryResponse
from services.chat_service import ChatService

router = APIRouter()
chat_service = ChatService(conversation_repository, build_provider())


@router.post("/v1/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, response: Response) -> ChatResponse:
    """Legacy compatibility endpoint: create/continue a chat conversation."""
    response.headers["X-API-Lifecycle"] = "legacy"
    return chat_service.chat(payload)


@router.get(
    "/v1/conversations/{conversation_id}",
    response_model=ConversationHistoryResponse,
)
def get_conversation_history(
    conversation_id: str,
    response: Response,
) -> ConversationHistoryResponse:
    """Legacy compatibility endpoint: return full chat history."""
    response.headers["X-API-Lifecycle"] = "legacy"
    history = chat_service.get_conversation_history(conversation_id)
    if history is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return history
