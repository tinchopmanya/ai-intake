from uuid import NAMESPACE_URL
from uuid import UUID
from uuid import uuid5


def resolve_user_id(value: str | None) -> UUID:
    if value:
        try:
            return UUID(value)
        except ValueError:
            return uuid5(NAMESPACE_URL, value)
    return UUID("00000000-0000-0000-0000-000000000001")

