import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _parse_cors_origins(raw_value: str) -> list[str]:
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    cors_origins: list[str]


def get_settings() -> Settings:
    cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    return Settings(cors_origins=_parse_cors_origins(cors_origins))


settings = get_settings()
