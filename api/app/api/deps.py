from collections.abc import Iterator

from app.db import build_postgres_connection_factory
from app.repositories import TrackingEventRepository
from app.repositories import UnitOfWork


def get_uow() -> Iterator[UnitOfWork]:
    connection_factory = build_postgres_connection_factory()
    tracking = TrackingEventRepository(connection_factory)
    with UnitOfWork(connection_factory, tracking_repository=tracking) as uow:
        yield uow

