from typing import Protocol

from domain.entities import Advisor
from domain.entities import AdvisorOutput
from domain.entities import Contact
from domain.entities import Group
from domain.entities import Skill
from domain.entities import StoredMessage
from domain.entities import User
from domain.entities import Conversation


class PersistenceStore(Protocol):
    def get_user(self, user_id: str) -> User | None:
        ...

    def get_contact(self, contact_id: str) -> Contact | None:
        ...

    def get_group(self, group_id: str) -> Group | None:
        ...

    def get_advisor(self, advisor_id: str) -> Advisor | None:
        ...

    def list_advisor_skills(self, advisor_id: str) -> list[Skill]:
        ...

    def list_contact_advisors(self, contact_id: str) -> list[Advisor]:
        ...

    def list_group_advisors(self, group_id: str) -> list[Advisor]:
        ...

    def list_user_default_advisors(self, user_id: str) -> list[Advisor]:
        ...

    def ensure_conversation(
        self,
        conversation_id: str | None,
        owner_user_id: str,
        contact_id: str | None,
        channel: str,
    ) -> Conversation:
        ...

    def get_conversation(self, conversation_id: str) -> Conversation | None:
        ...

    def list_conversations(
        self,
        channel: str,
        owner_user_id: str | None = None,
        contact_id: str | None = None,
    ) -> list[Conversation]:
        ...

    def append_message(
        self, conversation_id: str, role: str, message: str, channel: str
    ) -> StoredMessage:
        ...

    def get_conversation_messages(self, conversation_id: str) -> list[StoredMessage]:
        ...

    def save_advisor_output(self, output: AdvisorOutput) -> None:
        ...

    def list_advisor_outputs(self, conversation_id: str) -> list[AdvisorOutput]:
        ...
