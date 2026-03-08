from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class User:
    id: str
    name: str


@dataclass(frozen=True)
class Group:
    id: str
    owner_user_id: str
    name: str


@dataclass(frozen=True)
class Contact:
    id: str
    owner_user_id: str
    name: str
    group_id: str | None = None
    phone: str | None = None
    email: str | None = None
    profile_summary: str | None = None


@dataclass(frozen=True)
class Advisor:
    id: str
    name: str
    role: str
    description: str
    system_prompt_base: str
    image_url: str | None = None
    is_system: bool = True
    owner_user_id: str | None = None


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    type: str
    category: str
    is_system: bool
    prompt_snippet: str
    owner_user_id: str | None = None


@dataclass(frozen=True)
class AdvisorSkill:
    advisor_id: str
    skill_id: str


@dataclass(frozen=True)
class ContactAdvisor:
    contact_id: str
    advisor_id: str


@dataclass(frozen=True)
class GroupAdvisor:
    group_id: str
    advisor_id: str


@dataclass(frozen=True)
class UserAdvisor:
    user_id: str
    advisor_id: str


@dataclass(frozen=True)
class Conversation:
    id: str
    owner_user_id: str
    contact_id: str | None
    channel: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class StoredMessage:
    id: str
    conversation_id: str
    role: str
    message: str
    channel: str
    created_at: datetime


@dataclass(frozen=True)
class AdvisorOutput:
    id: str
    conversation_id: str | None
    owner_user_id: str
    contact_id: str | None
    advisor_id: str
    suggestions_json: str
    analysis_snapshot: str
    created_at: datetime
