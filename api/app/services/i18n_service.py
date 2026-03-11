from __future__ import annotations

import json
from pathlib import Path

SUPPORTED_LANGUAGES = {"es", "en", "pt"}
_FALLBACK_LANGUAGE = "es"


class I18nService:
    def __init__(self, resources_dir: Path | None = None) -> None:
        if resources_dir is None:
            resources_dir = Path(__file__).resolve().parent.parent / "resources" / "i18n"
        self._resources_dir = resources_dir
        self._cache: dict[str, dict[str, str]] = {}

    def resolve_language(self, accept_language: str | None) -> str:
        if not accept_language:
            return _FALLBACK_LANGUAGE
        candidates = [part.strip() for part in accept_language.split(",") if part.strip()]
        for candidate in candidates:
            code = candidate.split(";")[0].strip().lower()
            if "-" in code:
                code = code.split("-", maxsplit=1)[0]
            if code in SUPPORTED_LANGUAGES:
                return code
        return _FALLBACK_LANGUAGE

    def translate_error(self, code: str, *, language_code: str) -> str:
        messages = self._load_messages(language_code)
        key = f"error.{code}"
        return messages.get(key, code)

    def _load_messages(self, language_code: str) -> dict[str, str]:
        normalized = language_code if language_code in SUPPORTED_LANGUAGES else _FALLBACK_LANGUAGE
        cached = self._cache.get(normalized)
        if cached is not None:
            return cached

        path = self._resources_dir / f"{normalized}.json"
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        messages = {str(key): str(value) for key, value in payload.items()}
        self._cache[normalized] = messages
        return messages


i18n_service = I18nService()
