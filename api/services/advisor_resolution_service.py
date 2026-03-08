from domain.entities import Advisor
from repositories.persistence import PersistenceStore


class AdvisorResolutionService:
    def __init__(self, store: PersistenceStore) -> None:
        self._store = store

    def resolve_for_session(
        self, user_id: str, contact_id: str | None = None, max_advisors: int = 3
    ) -> list[Advisor]:
        resolved: list[Advisor] = []
        seen_ids: set[str] = set()

        def add_candidates(candidates: list[Advisor]) -> None:
            for advisor in candidates:
                if advisor.id in seen_ids:
                    continue
                seen_ids.add(advisor.id)
                resolved.append(advisor)
                if len(resolved) >= max_advisors:
                    return

        if contact_id:
            contact = self._store.get_contact(contact_id)
            if contact is not None:
                add_candidates(self._store.list_contact_advisors(contact_id))
                if len(resolved) >= max_advisors:
                    return resolved
                if contact.group_id:
                    add_candidates(self._store.list_group_advisors(contact.group_id))
                    if len(resolved) >= max_advisors:
                        return resolved

        add_candidates(self._store.list_user_default_advisors(user_id))
        return resolved[:max_advisors]
