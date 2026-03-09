from collections.abc import Callable
from typing import Any
from typing import Protocol


class CursorProtocol(Protocol):
    rowcount: int

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> Any:
        ...

    def fetchone(self) -> Any:
        ...

    def fetchall(self) -> Any:
        ...

    def close(self) -> None:
        ...

    def __enter__(self) -> "CursorProtocol":
        ...

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        ...


class ConnectionProtocol(Protocol):
    def cursor(self) -> CursorProtocol:
        ...

    def commit(self) -> None:
        ...

    def rollback(self) -> None:
        ...

    def close(self) -> None:
        ...


ConnectionFactory = Callable[[], ConnectionProtocol]
