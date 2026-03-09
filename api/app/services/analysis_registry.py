from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from typing import Any
from uuid import UUID


@dataclass(frozen=True)
class StoredAnalysis:
    analysis_id: UUID
    summary: str
    risk_flags: list[dict[str, Any]]
    emotional_context: dict[str, str]
    ui_alerts: list[dict[str, str]]
    created_at: datetime


class AnalysisRegistry:
    def __init__(self) -> None:
        self._items: dict[UUID, StoredAnalysis] = {}
        self._lock = Lock()

    def put(self, item: StoredAnalysis) -> None:
        with self._lock:
            self._items[item.analysis_id] = item

    def get(self, analysis_id: UUID) -> StoredAnalysis | None:
        with self._lock:
            return self._items.get(analysis_id)


analysis_registry = AnalysisRegistry()

