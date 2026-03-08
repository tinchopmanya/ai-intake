from fastapi import APIRouter
from fastapi import HTTPException

from config import settings
from providers.base import AIProvider
from providers.fallback import UnconfiguredAIProvider
from providers.gemini import GeminiAIProvider
from repositories.in_memory import conversation_repository
from schemas import ChatRequest
from schemas import ChatResponse
from schemas import ConversationHistoryResponse
from services.chat_service import ChatService

router = APIRouter()


def _build_provider() -> AIProvider:
    if not settings.gemini_api_key:
        return UnconfiguredAIProvider()
    return GeminiAIProvider(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        timeout_seconds=settings.gemini_timeout_seconds,
    )


chat_service = ChatService(conversation_repository, _build_provider())


@router.post("/v1/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    return chat_service.chat(payload)


@router.get(
    "/v1/conversations/{conversation_id}",
    response_model=ConversationHistoryResponse,
)
def get_conversation_history(conversation_id: str) -> ConversationHistoryResponse:
    response = chat_service.get_conversation_history(conversation_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return response
