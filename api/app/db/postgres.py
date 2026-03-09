import os
from collections.abc import Callable
from typing import Any

from app.repositories.protocols import ConnectionProtocol


def build_postgres_connection_factory(
    dsn: str | None = None,
) -> Callable[[], ConnectionProtocol]:
    database_dsn = dsn or os.getenv("DATABASE_URL")
    if not database_dsn:
        raise RuntimeError("DATABASE_URL is required to build PostgreSQL connection factory")

    def _factory() -> ConnectionProtocol:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except Exception as exc:
            raise RuntimeError(
                "psycopg is required for PostgreSQL persistence. Install it before using repositories."
            ) from exc

        connection: Any = psycopg.connect(database_dsn, row_factory=dict_row)
        return connection

    return _factory

