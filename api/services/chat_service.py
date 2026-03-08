from uuid import uuid4

from repositories.in_memory import InMemoryConversationRepository
from schemas import ChatRequest
from schemas import ChatResponse
from schemas import ConversationHistoryResponse
from schemas import Message


class ChatService:
    def __init__(self, repository: InMemoryConversationRepository) -> None:
        self._repository = repository

    def chat(self, payload: ChatRequest) -> ChatResponse:
        conversation_id = payload.conversation_id or str(uuid4())
        answer = f"echo: {payload.message}"

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
