import re
import unicodedata

from domain.entities import Contact
from repositories.persistence import PersistenceStore
from schemas import ContactResolutionCandidate
from schemas import ContactResolutionMetadata


class ContactResolutionService:
    def __init__(self, store: PersistenceStore) -> None:
        self._store = store

    def resolve(self, user_id: str, conversation_text: str) -> ContactResolutionMetadata:
        user = self._store.get_user(user_id)
        contacts = self._store.list_contacts_by_user(user_id)
        if not conversation_text.strip() or not contacts:
            return ContactResolutionMetadata(resolution_mode="unresolved")

        participant_names = self._extract_participants(conversation_text)
        owner_aliases = self._build_owner_aliases(user.name if user is not None else "")

        owner_detected_name = next(
            (name for name in participant_names if self._is_owner_alias(name, owner_aliases)),
            None,
        )

        external_names = [
            name for name in participant_names if not self._is_owner_alias(name, owner_aliases)
        ]
        if not external_names:
            return ContactResolutionMetadata(
                resolution_mode="unresolved",
                owner_detected_name=owner_detected_name,
            )

        candidates = self._build_candidates(contacts, external_names)
        if not candidates:
            return ContactResolutionMetadata(
                resolution_mode="heuristic",
                owner_detected_name=owner_detected_name,
            )

        top_confidence = candidates[0].confidence
        top_candidates = [
            candidate
            for candidate in candidates
            if abs(candidate.confidence - top_confidence) < 0.001
        ]

        if len(top_candidates) > 1:
            return ContactResolutionMetadata(
                resolution_mode="unresolved",
                owner_detected_name=owner_detected_name,
                candidate_contacts=top_candidates,
                confidence=top_confidence,
            )

        winner = top_candidates[0]
        return ContactResolutionMetadata(
            resolved_contact_id=winner.contact_id,
            resolved_contact_name=winner.contact_name,
            resolution_mode=winner.match_mode,
            candidate_contacts=top_candidates,
            owner_detected_name=owner_detected_name,
            confidence=winner.confidence,
        )

    def _extract_participants(self, conversation_text: str) -> list[str]:
        pattern = re.compile(r"^\s*([^\n:]{1,40})\s*:\s*.+$", flags=re.MULTILINE)
        seen: set[str] = set()
        participants: list[str] = []
        for match in pattern.finditer(conversation_text):
            raw_name = match.group(1).strip()
            normalized = self._normalize(raw_name)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            participants.append(raw_name)
        return participants

    def _build_owner_aliases(self, user_name: str) -> set[str]:
        aliases = {"yo", "me", "mi", "mio", "mía", "mio/a", "usuario"}
        normalized_user_name = self._normalize(user_name)
        if normalized_user_name:
            aliases.add(normalized_user_name)
            first_token = normalized_user_name.split(" ")[0]
            aliases.add(first_token)
        return aliases

    def _is_owner_alias(self, candidate: str, owner_aliases: set[str]) -> bool:
        normalized = self._normalize(candidate)
        return normalized in owner_aliases

    def _build_candidates(
        self, contacts: list[Contact], participant_names: list[str]
    ) -> list[ContactResolutionCandidate]:
        candidates: list[ContactResolutionCandidate] = []
        for participant_name in participant_names:
            participant_normalized = self._normalize(participant_name)
            if not participant_normalized:
                continue
            for contact in contacts:
                contact_normalized = self._normalize(contact.name)
                if not contact_normalized:
                    continue
                if participant_normalized == contact_normalized:
                    candidates.append(
                        ContactResolutionCandidate(
                            contact_id=contact.id,
                            contact_name=contact.name,
                            match_mode="exact_match",
                            confidence=1.0,
                        )
                    )
                    continue
                if (
                    participant_normalized in contact_normalized
                    or contact_normalized in participant_normalized
                ):
                    candidates.append(
                        ContactResolutionCandidate(
                            contact_id=contact.id,
                            contact_name=contact.name,
                            match_mode="fuzzy_match",
                            confidence=0.75,
                        )
                    )

        deduped_by_contact: dict[str, ContactResolutionCandidate] = {}
        for candidate in candidates:
            current = deduped_by_contact.get(candidate.contact_id)
            if current is None or candidate.confidence > current.confidence:
                deduped_by_contact[candidate.contact_id] = candidate

        return sorted(
            deduped_by_contact.values(),
            key=lambda item: item.confidence,
            reverse=True,
        )

    def _normalize(self, value: str) -> str:
        stripped = value.strip().lower()
        if not stripped:
            return ""
        normalized = unicodedata.normalize("NFKD", stripped)
        without_accents = "".join(
            char for char in normalized if not unicodedata.combining(char)
        )
        return re.sub(r"\s+", " ", without_accents)
