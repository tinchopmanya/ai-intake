from schemas import Message


class InMemoryConversationRepository:
    def __init__(self) -> None:
        self._conversations: dict[str, list[Message]] = {}

    @property
    def conversations(self) -> dict[str, list[Message]]:
        return self._conversations

    def append_message(self, conversation_id: str, message: Message) -> None:
        history = self._conversations.setdefault(conversation_id, [])
        history.append(message)

    def get_messages(self, conversation_id: str) -> list[Message] | None:
        return self._conversations.get(conversation_id)


conversation_repository = InMemoryConversationRepository()
