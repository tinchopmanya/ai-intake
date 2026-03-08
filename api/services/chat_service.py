import logging
from uuid import uuid4

from providers.base import AIProvider
from repositories.in_memory import InMemoryConversationRepository
from schemas import ChatRequest
from schemas import ChatResponse
from schemas import ConversationHistoryResponse
from schemas import Message

logger = logging.getLogger(__name__)


class ChatService:
    def __init__(
        self,
        repository: InMemoryConversationRepository,
        provider: AIProvider,
    ) -> None:
        self._repository = repository
        self._provider = provider

    def chat(self, payload: ChatRequest) -> ChatResponse:
        conversation_id = payload.conversation_id or str(uuid4())
        answer = self._generate_answer(payload.message)

        self._repository.append_message(
            conversation_id,
            Message(
                role="user",
                message=payload.message,
                channel=payload.channel,
            ),
        )
        self._repository.append_message(
            conversation_id,
            Message(
                role="assistant",
                message=answer,
                channel="assistant",
            ),
        )

        return ChatResponse(conversation_id=conversation_id, answer=answer)

    def _generate_answer(self, message: str) -> str:
        try:
            return self._provider.generate_answer(message)
        except Exception:
            logger.exception(
                "Failed to generate chat answer with provider=%s",
                type(self._provider).__name__,
            )
            return "No pude generar una respuesta de IA en este momento. Intenta de nuevo."

    def get_conversation_history(
        self, conversation_id: str
    ) -> ConversationHistoryResponse | None:
        messages = self._repository.get_messages(conversation_id)
        if messages is None:
            return None
        return ConversationHistoryResponse(
            conversation_id=conversation_id,
            messages=messages,
        )
