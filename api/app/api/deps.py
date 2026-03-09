from collections.abc import Iterator

from app.db import build_postgres_connection_factory
from app.repositories import TrackingEventRepository
from app.repositories import UnitOfWork
from providers.base import AIProvider
from providers.factory import build_provider


def get_uow() -> Iterator[UnitOfWork | None]:
    try:
        connection_factory = build_postgres_connection_factory()
    except RuntimeError:
        yield None
        return

    tracking = TrackingEventRepository(connection_factory)
    with UnitOfWork(connection_factory, tracking_repository=tracking) as uow:
        yield uow


def get_ai_provider() -> AIProvider:
    return build_provider()

