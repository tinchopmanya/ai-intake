from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from threading import Lock
from typing import Any
from uuid import UUID


class AnalysisOwnershipError(Exception):
    pass


@dataclass(frozen=True)
class StoredAnalysis:
    analysis_id: UUID
    user_id: UUID
    summary: str
    risk_flags: list[dict[str, Any]]
    emotional_context: dict[str, str]
    ui_alerts: list[dict[str, str]]
    created_at: datetime
    expires_at: datetime


class AnalysisRegistry:
    def __init__(self, *, ttl_seconds: int = 1800) -> None:
        self._items: dict[UUID, StoredAnalysis] = {}
        self._lock = Lock()
        self._ttl = timedelta(seconds=ttl_seconds)

    def put(self, item: StoredAnalysis) -> None:
        with self._lock:
            now = datetime.now(UTC)
            self._cleanup_locked(now)
            self._items[item.analysis_id] = item

    def get_for_user(self, analysis_id: UUID, user_id: UUID) -> StoredAnalysis | None:
        with self._lock:
            now = datetime.now(UTC)
            self._cleanup_locked(now)
            item = self._items.get(analysis_id)
            if item is None:
                return None
            if item.user_id != user_id:
                raise AnalysisOwnershipError("analysis_id does not belong to current user")
            if item.expires_at <= now:
                self._items.pop(analysis_id, None)
                return None
            return item

    def ttl_seconds(self) -> int:
        return int(self._ttl.total_seconds())

    def build_expires_at(self, created_at: datetime | None = None) -> datetime:
        base = created_at or datetime.now(UTC)
        return base + self._ttl

    def _cleanup_locked(self, now: datetime) -> None:
        expired_ids = [
            analysis_id
            for analysis_id, item in self._items.items()
            if item.expires_at <= now
        ]
        for analysis_id in expired_ids:
            self._items.pop(analysis_id, None)


analysis_registry = AnalysisRegistry()

