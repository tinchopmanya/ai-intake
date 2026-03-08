from dataclasses import asdict
from datetime import UTC
from datetime import datetime
from uuid import uuid4

from domain.entities import Advisor
from domain.entities import AdvisorOutput
from domain.entities import AdvisorSkill
from domain.entities import Contact
from domain.entities import ContactAdvisor
from domain.entities import Conversation
from domain.entities import Group
from domain.entities import GroupAdvisor
from domain.entities import Skill
from domain.entities import StoredMessage
from domain.entities import User
from domain.entities import UserAdvisor
from repositories.persistence import PersistenceStore


class InMemoryPersistenceStore(PersistenceStore):
    def __init__(self) -> None:
        self.users: dict[str, User] = {}
        self.groups: dict[str, Group] = {}
        self.contacts: dict[str, Contact] = {}
        self.advisors: dict[str, Advisor] = {}
        self.skills: dict[str, Skill] = {}
        self.advisor_skills: list[AdvisorSkill] = []
        self.contact_advisors: list[ContactAdvisor] = []
        self.group_advisors: list[GroupAdvisor] = []
        self.user_advisors: list[UserAdvisor] = []
        self.conversations: dict[str, Conversation] = {}
        self.messages: dict[str, list[StoredMessage]] = {}
        self.advisor_outputs: list[AdvisorOutput] = []
        self._seed()

    def _seed(self) -> None:
        user = User(id="user-main", name="Martin")
        self.users[user.id] = user

        family_group = Group(id="group-family", owner_user_id=user.id, name="Familia")
        work_group = Group(id="group-work", owner_user_id=user.id, name="Trabajo")
        self.groups[family_group.id] = family_group
        self.groups[work_group.id] = work_group

        self.contacts["contact-ex"] = Contact(
            id="contact-ex",
            owner_user_id=user.id,
            name="Ex Pareja",
            group_id=family_group.id,
        )
        self.contacts["contact-colleague"] = Contact(
            id="contact-colleague",
            owner_user_id=user.id,
            name="Colega",
            group_id=work_group.id,
        )

        self._seed_advisors()
        self._seed_skills()
        self._seed_relationships(user.id, family_group.id, work_group.id)

    def _seed_advisors(self) -> None:
        advisors = [
            Advisor(
                id="laura",
                name="Laura",
                role="Psicologa",
                description="Empatica y enfocada en dinamicas emocionales.",
                system_prompt_base=(
                    "Eres Laura, psicologa relacional. Priorizas empatia, escucha y claridad emocional."
                ),
                image_url=None,
            ),
            Advisor(
                id="robert",
                name="Robert",
                role="Abogado",
                description="Directo, firme y orientado a limites claros.",
                system_prompt_base=(
                    "Eres Robert, abogado estrategico. Priorizas claridad, limites y gestion de riesgo."
                ),
                image_url=None,
            ),
            Advisor(
                id="lidia",
                name="Lidia",
                role="Coach",
                description="Pragmatica y orientada a accion concreta.",
                system_prompt_base=(
                    "Eres Lidia, coach de accion. Priorizas foco, agencia personal y pasos concretos."
                ),
                image_url=None,
            ),
        ]
        for advisor in advisors:
            self.advisors[advisor.id] = advisor

    def _seed_skills(self) -> None:
        skills = [
            Skill("amable", "Amable", "trait", "tone", True, "Usa lenguaje calido y valida emociones."),
            Skill("calida", "Calida", "trait", "tone", True, "Responde con tono cercano y humano."),
            Skill("reflexiva", "Reflexiva", "trait", "tone", True, "Invita a mirar la perspectiva de ambas partes."),
            Skill("psicologia", "Psicologia", "knowledge", "knowledge", True, "Aplica inteligencia emocional."),
            Skill("escucha-activa", "Escucha activa", "knowledge", "knowledge", True, "Incluye validacion y parafraseo."),
            Skill("no-conflictiva", "No conflictiva", "trait", "tone", True, "Desescala la tension con lenguaje neutral."),
            Skill("limites", "Pone limites", "trait", "tone", True, "Expresa limites con claridad y sin agresion."),
            Skill("directa", "Directa", "trait", "tone", True, "Ve al punto central con claridad."),
            Skill("firme", "Firme", "trait", "tone", True, "Mantiene postura clara y segura."),
            Skill("honesta", "Honesta", "trait", "tone", True, "Prioriza claridad util aunque incomode."),
            Skill("legal", "Analisis legal", "knowledge", "knowledge", True, "Detecta riesgos legales y contractuales."),
            Skill("negociacion", "Negociacion", "knowledge", "strategy", True, "Abre opciones de acuerdo y beneficio mutuo."),
            Skill(
                "comunicacion-asertiva",
                "Comunicacion asertiva",
                "knowledge",
                "strategy",
                True,
                "Expresa necesidades sin atacar al otro.",
            ),
            Skill("empoderada", "Empoderada", "trait", "tone", True, "Refuerza agencia y opciones concretas."),
            Skill("breve", "Breve", "trait", "style", True, "Respuestas cortas y practicas."),
            Skill("coaching", "Coaching", "knowledge", "knowledge", True, "Enfoca en proximo paso accionable."),
            Skill(
                "orientada-accion",
                "Orientada a la accion",
                "trait",
                "strategy",
                True,
                "Convierte analisis en acciones concretas.",
            ),
            Skill(
                "regulacion-emocional",
                "Regulacion emocional",
                "trait",
                "strategy",
                True,
                "Evita respuestas impulsivas y reactivas.",
            ),
        ]
        for skill in skills:
            self.skills[skill.id] = skill

    def _seed_relationships(self, user_id: str, family_group_id: str, work_group_id: str) -> None:
        self.advisor_skills.extend(
            [
                AdvisorSkill("laura", "amable"),
                AdvisorSkill("laura", "calida"),
                AdvisorSkill("laura", "reflexiva"),
                AdvisorSkill("laura", "psicologia"),
                AdvisorSkill("laura", "escucha-activa"),
                AdvisorSkill("laura", "no-conflictiva"),
                AdvisorSkill("laura", "limites"),
                AdvisorSkill("robert", "directa"),
                AdvisorSkill("robert", "firme"),
                AdvisorSkill("robert", "honesta"),
                AdvisorSkill("robert", "legal"),
                AdvisorSkill("robert", "negociacion"),
                AdvisorSkill("robert", "comunicacion-asertiva"),
                AdvisorSkill("robert", "limites"),
                AdvisorSkill("lidia", "empoderada"),
                AdvisorSkill("lidia", "breve"),
                AdvisorSkill("lidia", "coaching"),
                AdvisorSkill("lidia", "orientada-accion"),
                AdvisorSkill("lidia", "calida"),
                AdvisorSkill("lidia", "regulacion-emocional"),
                AdvisorSkill("lidia", "limites"),
            ]
        )

        self.contact_advisors.extend(
            [
                ContactAdvisor("contact-ex", "laura"),
                ContactAdvisor("contact-colleague", "robert"),
            ]
        )
        self.group_advisors.extend(
            [
                GroupAdvisor(family_group_id, "lidia"),
                GroupAdvisor(work_group_id, "lidia"),
            ]
        )
        self.user_advisors.extend(
            [
                UserAdvisor(user_id, "laura"),
                UserAdvisor(user_id, "robert"),
                UserAdvisor(user_id, "lidia"),
            ]
        )

    def get_user(self, user_id: str) -> User | None:
        return self.users.get(user_id)

    def get_contact(self, contact_id: str) -> Contact | None:
        return self.contacts.get(contact_id)

    def get_group(self, group_id: str) -> Group | None:
        return self.groups.get(group_id)

    def get_advisor(self, advisor_id: str) -> Advisor | None:
        return self.advisors.get(advisor_id)

    def list_advisor_skills(self, advisor_id: str) -> list[Skill]:
        skill_ids = [
            relation.skill_id
            for relation in self.advisor_skills
            if relation.advisor_id == advisor_id
        ]
        return [self.skills[skill_id] for skill_id in skill_ids if skill_id in self.skills]

    def list_contact_advisors(self, contact_id: str) -> list[Advisor]:
        advisor_ids = [
            relation.advisor_id
            for relation in self.contact_advisors
            if relation.contact_id == contact_id
        ]
        return [self.advisors[advisor_id] for advisor_id in advisor_ids if advisor_id in self.advisors]

    def list_group_advisors(self, group_id: str) -> list[Advisor]:
        advisor_ids = [
            relation.advisor_id
            for relation in self.group_advisors
            if relation.group_id == group_id
        ]
        return [self.advisors[advisor_id] for advisor_id in advisor_ids if advisor_id in self.advisors]

    def list_user_default_advisors(self, user_id: str) -> list[Advisor]:
        advisor_ids = [
            relation.advisor_id
            for relation in self.user_advisors
            if relation.user_id == user_id
        ]
        return [self.advisors[advisor_id] for advisor_id in advisor_ids if advisor_id in self.advisors]

    def ensure_conversation(
        self,
        conversation_id: str | None,
        owner_user_id: str,
        contact_id: str | None,
        channel: str,
    ) -> Conversation:
        now = datetime.now(UTC)
        resolved_id = conversation_id or str(uuid4())
        current = self.conversations.get(resolved_id)
        if current is None:
            created = Conversation(
                id=resolved_id,
                owner_user_id=owner_user_id,
                contact_id=contact_id,
                channel=channel,
                created_at=now,
                updated_at=now,
            )
            self.conversations[resolved_id] = created
            return created

        updated = Conversation(
            id=current.id,
            owner_user_id=current.owner_user_id,
            contact_id=current.contact_id,
            channel=current.channel,
            created_at=current.created_at,
            updated_at=now,
        )
        self.conversations[resolved_id] = updated
        return updated

    def get_conversation(self, conversation_id: str) -> Conversation | None:
        return self.conversations.get(conversation_id)

    def list_conversations(
        self,
        channel: str,
        owner_user_id: str | None = None,
        contact_id: str | None = None,
    ) -> list[Conversation]:
        items = [
            conversation
            for conversation in self.conversations.values()
            if conversation.channel == channel
        ]
        if owner_user_id is not None:
            items = [
                conversation
                for conversation in items
                if conversation.owner_user_id == owner_user_id
            ]
        if contact_id is not None:
            items = [
                conversation for conversation in items if conversation.contact_id == contact_id
            ]
        return sorted(items, key=lambda conversation: conversation.updated_at, reverse=True)

    def append_message(
        self, conversation_id: str, role: str, message: str, channel: str
    ) -> StoredMessage:
        now = datetime.now(UTC)
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = Conversation(
                id=conversation_id,
                owner_user_id="user-main",
                contact_id=None,
                channel=channel,
                created_at=now,
                updated_at=now,
            )
        else:
            conversation = self.conversations[conversation_id]
            self.conversations[conversation_id] = Conversation(
                id=conversation.id,
                owner_user_id=conversation.owner_user_id,
                contact_id=conversation.contact_id,
                channel=conversation.channel,
                created_at=conversation.created_at,
                updated_at=now,
            )

        stored = StoredMessage(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role=role,
            message=message,
            channel=channel,
            created_at=now,
        )
        self.messages.setdefault(conversation_id, []).append(stored)
        return stored

    def get_conversation_messages(self, conversation_id: str) -> list[StoredMessage]:
        return list(self.messages.get(conversation_id, []))

    def save_advisor_output(self, output: AdvisorOutput) -> None:
        self.advisor_outputs.append(output)

    def list_advisor_outputs(self, conversation_id: str) -> list[AdvisorOutput]:
        return [
            output
            for output in self.advisor_outputs
            if output.conversation_id == conversation_id
        ]

    def dump_state(self) -> dict[str, object]:
        return {
            "users": [asdict(item) for item in self.users.values()],
            "groups": [asdict(item) for item in self.groups.values()],
            "contacts": [asdict(item) for item in self.contacts.values()],
            "advisors": [asdict(item) for item in self.advisors.values()],
            "skills": [asdict(item) for item in self.skills.values()],
        }


persistence_store = InMemoryPersistenceStore()
