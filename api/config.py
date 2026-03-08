import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _parse_cors_origins(raw_value: str) -> list[str]:
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    cors_origins: list[str]
    gemini_api_key: str | None
    gemini_model: str
    gemini_timeout_seconds: float


def get_settings() -> Settings:
    cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    gemini_timeout_seconds = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "20"))
    return Settings(
        cors_origins=_parse_cors_origins(cors_origins),
        gemini_api_key=gemini_api_key if gemini_api_key else None,
        gemini_model=gemini_model,
        gemini_timeout_seconds=gemini_timeout_seconds,
    )


settings = get_settings()
