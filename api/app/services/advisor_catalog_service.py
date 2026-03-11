from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AdvisorCatalogItem:
    id: str
    name: str
    role: str
    tone: str


class AdvisorCatalogService:
    def __init__(self, resources_dir: Path | None = None) -> None:
        if resources_dir is None:
            resources_dir = Path(__file__).resolve().parent.parent / "resources" / "advisors"
        self._resources_dir = resources_dir

    def resolve(
        self,
        *,
        country_code: str | None,
        language_code: str | None,
    ) -> list[AdvisorCatalogItem]:
        country = (country_code or "UY").upper()
        language = (language_code or "es").lower()
        candidates = [
            f"{language}-{country}.json",
            f"{language}-UY.json",
            "es-UY.json",
        ]
        for filename in candidates:
            catalog = self._load_file(filename)
            if catalog:
                return catalog[:3]
        return self._default()

    def _load_file(self, filename: str) -> list[AdvisorCatalogItem]:
        path = self._resources_dir / filename
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []

        advisors_raw = payload.get("advisors")
        if not isinstance(advisors_raw, list):
            return []

        resolved: list[AdvisorCatalogItem] = []
        for item in advisors_raw:
            if not isinstance(item, dict):
                continue
            if item.get("enabled") is False:
                continue
            advisor_id = str(item.get("id", "")).strip().lower()
            if not advisor_id:
                continue
            resolved.append(
                AdvisorCatalogItem(
                    id=advisor_id,
                    name=str(item.get("name") or advisor_id).strip() or advisor_id,
                    role=str(item.get("role") or "").strip(),
                    tone=str(item.get("tone") or "").strip(),
                )
            )
        return resolved

    def _default(self) -> list[AdvisorCatalogItem]:
        return [
            AdvisorCatalogItem(
                id="laura",
                name="Laura",
                role="Empatica",
                tone="calmado",
            ),
            AdvisorCatalogItem(
                id="robert",
                name="Robert",
                role="Estrategico",
                tone="directo",
            ),
            AdvisorCatalogItem(
                id="lidia",
                name="Lidia",
                role="Neutral",
                tone="objetivo",
            ),
        ]
