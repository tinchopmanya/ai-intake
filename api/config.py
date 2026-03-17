import os
from dataclasses import dataclass
import logging
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)
_CONFIG_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _CONFIG_DIR.parent


def _load_environment_files() -> None:
    root_env = _REPO_ROOT / ".env"
    api_env = _CONFIG_DIR / ".env"
    loaded_paths: list[str] = []

    if root_env.exists():
        load_dotenv(dotenv_path=root_env, override=False)
        loaded_paths.append(str(root_env))
    if api_env.exists():
        load_dotenv(dotenv_path=api_env, override=True)
        loaded_paths.append(str(api_env))

    if not loaded_paths:
        load_dotenv()
        loaded_paths.append(".env (auto-discovery)")

    logger.info("Environment files loaded for backend config: %s", ", ".join(loaded_paths))


def _normalize_bom_prefixed_env_keys() -> None:
    normalized: list[str] = []
    for key in list(os.environ.keys()):
        if not key.startswith("\ufeff"):
            continue
        clean_key = key.lstrip("\ufeff")
        if not clean_key:
            continue
        if clean_key not in os.environ:
            os.environ[clean_key] = os.environ.get(key, "")
            normalized.append(clean_key)
    if normalized:
        logger.warning(
            "Normalized BOM-prefixed environment keys: %s",
            ", ".join(normalized),
        )


_load_environment_files()
_normalize_bom_prefixed_env_keys()


def _parse_cors_origins(raw_value: str) -> list[str]:
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    app_env: str
    is_local_env: bool
    is_production_env: bool
    is_validation_env: bool
    allow_inmemory_fallback: bool
    enable_legacy_chat_routes: bool
    database_url: str | None
    cors_origins: list[str]
    gemini_api_key: str | None
    gemini_model: str
    gemini_timeout_seconds: float
    google_client_id: str | None
    auth_access_ttl_seconds: int
    auth_refresh_ttl_seconds: int
    ocr_provider: str
    ocr_max_file_bytes: int
    ocr_tesseract_cmd: str | None
    ocr_tesseract_lang: str
    ocr_tesseract_psm: int
    ocr_tesseract_oem: int
    ocr_whatsapp_crop_top_px: int
    ocr_whatsapp_crop_bottom_px: int
    ocr_wa_top_crop_ratio: float
    ocr_wa_bottom_crop_ratio: float
    ocr_whatsapp_crop_enabled: bool
    ocr_turn_detection_enabled: bool


def _parse_bool(raw_value: str | None, default: bool) -> bool:
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_env(raw_value: str | None) -> str:
    normalized = (raw_value or "development").strip().lower()
    return normalized or "development"


def _is_local_env(app_env: str) -> bool:
    return app_env in {"local", "development", "dev", "test"}


def _is_production_env(app_env: str) -> bool:
    return app_env in {"production", "prod"}


def _is_validation_env(app_env: str) -> bool:
    return app_env in {"validation", "mvp_validation"}


def get_settings() -> Settings:
    app_env_raw = (
        os.getenv("APP_ENV")
        or os.getenv("ENV")
        or os.getenv("PYTHON_ENV")
        or "development"
    )
    app_env = _normalize_env(app_env_raw)
    is_local_env = _is_local_env(app_env)
    is_production_env = _is_production_env(app_env)
    is_validation_env = _is_validation_env(app_env)
    allow_inmemory_fallback = _parse_bool(
        os.getenv("ALLOW_INMEMORY_FALLBACK"),
        is_local_env,
    )
    enable_legacy_chat_routes = _parse_bool(
        os.getenv("ENABLE_LEGACY_CHAT_ROUTES"),
        False,
    )
    database_url = os.getenv("DATABASE_URL")
    cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    gemini_timeout_seconds = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "20"))
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    auth_access_ttl_seconds = int(os.getenv("AUTH_ACCESS_TTL_SECONDS", "900"))
    auth_refresh_ttl_seconds = int(
        os.getenv("AUTH_REFRESH_TTL_SECONDS", str(60 * 60 * 24 * 30))
    )
    ocr_provider = os.getenv("OCR_PROVIDER", "auto").strip().lower()
    ocr_max_file_bytes = int(os.getenv("OCR_MAX_FILE_BYTES", str(8 * 1024 * 1024)))
    ocr_tesseract_cmd = os.getenv("OCR_TESSERACT_CMD")
    ocr_tesseract_lang = os.getenv("OCR_TESSERACT_LANG", "spa+por+eng").strip()
    ocr_tesseract_psm = int(os.getenv("OCR_TESSERACT_PSM", "6"))
    ocr_tesseract_oem = int(os.getenv("OCR_TESSERACT_OEM", "3"))
    ocr_whatsapp_crop_top_px = int(os.getenv("OCR_WHATSAPP_CROP_TOP_PX", "80"))
    ocr_whatsapp_crop_bottom_px = int(os.getenv("OCR_WHATSAPP_CROP_BOTTOM_PX", "120"))
    ocr_wa_top_crop_ratio = float(os.getenv("OCR_WA_TOP_CROP_RATIO", "0.15"))
    ocr_wa_bottom_crop_ratio = float(os.getenv("OCR_WA_BOTTOM_CROP_RATIO", "0.17"))
    ocr_whatsapp_crop_enabled = _parse_bool(
        os.getenv("OCR_WHATSAPP_CROP_ENABLED"), True
    )
    ocr_turn_detection_enabled = _parse_bool(
        os.getenv("OCR_TURN_DETECTION_ENABLED"), True
    )
    return Settings(
        app_env=app_env,
        is_local_env=is_local_env,
        is_production_env=is_production_env,
        is_validation_env=is_validation_env,
        allow_inmemory_fallback=allow_inmemory_fallback,
        enable_legacy_chat_routes=enable_legacy_chat_routes,
        database_url=database_url.strip() if database_url else None,
        cors_origins=_parse_cors_origins(cors_origins),
        gemini_api_key=gemini_api_key.strip() if gemini_api_key and gemini_api_key.strip() else None,
        gemini_model=gemini_model,
        gemini_timeout_seconds=gemini_timeout_seconds,
        google_client_id=google_client_id.strip() if google_client_id and google_client_id.strip() else None,
        auth_access_ttl_seconds=auth_access_ttl_seconds,
        auth_refresh_ttl_seconds=auth_refresh_ttl_seconds,
        ocr_provider=ocr_provider if ocr_provider else "auto",
        ocr_max_file_bytes=ocr_max_file_bytes,
        ocr_tesseract_cmd=ocr_tesseract_cmd if ocr_tesseract_cmd else None,
        ocr_tesseract_lang=ocr_tesseract_lang if ocr_tesseract_lang else "spa+por+eng",
        ocr_tesseract_psm=max(3, min(13, ocr_tesseract_psm)),
        ocr_tesseract_oem=max(0, min(3, ocr_tesseract_oem)),
        ocr_whatsapp_crop_top_px=max(0, ocr_whatsapp_crop_top_px),
        ocr_whatsapp_crop_bottom_px=max(0, ocr_whatsapp_crop_bottom_px),
        ocr_wa_top_crop_ratio=max(0.0, min(0.4, ocr_wa_top_crop_ratio)),
        ocr_wa_bottom_crop_ratio=max(0.0, min(0.4, ocr_wa_bottom_crop_ratio)),
        ocr_whatsapp_crop_enabled=ocr_whatsapp_crop_enabled,
        ocr_turn_detection_enabled=ocr_turn_detection_enabled,
    )


def _is_multipart_available() -> bool:
    try:
        import multipart  # type: ignore # noqa: F401

        return True
    except Exception:
        return False


def validate_startup_settings(current: Settings) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not current.is_local_env and not current.database_url:
        errors.append(
            "DATABASE_URL is required when APP_ENV is not local/development/test."
        )
    elif (
        current.is_local_env
        and not current.database_url
        and current.allow_inmemory_fallback
    ):
        warnings.append(
            "DATABASE_URL is missing. Running in explicit in-memory fallback mode."
        )
    elif (
        current.is_local_env
        and not current.database_url
        and not current.allow_inmemory_fallback
    ):
        errors.append(
            "DATABASE_URL is missing and ALLOW_INMEMORY_FALLBACK=false."
        )

    if current.is_production_env and not current.google_client_id:
        errors.append(
            "GOOGLE_CLIENT_ID is required in production for Google auth."
        )

    from app.services.ocr_service import OcrService

    ocr_service = OcrService(
        provider=current.ocr_provider,
        tesseract_cmd=current.ocr_tesseract_cmd,
        tesseract_lang=current.ocr_tesseract_lang,
        tesseract_psm=current.ocr_tesseract_psm,
        tesseract_oem=current.ocr_tesseract_oem,
        whatsapp_crop_top_px=current.ocr_whatsapp_crop_top_px,
        whatsapp_crop_bottom_px=current.ocr_whatsapp_crop_bottom_px,
        wa_top_crop_ratio=current.ocr_wa_top_crop_ratio,
        wa_bottom_crop_ratio=current.ocr_wa_bottom_crop_ratio,
        whatsapp_crop_enabled=current.ocr_whatsapp_crop_enabled,
        turn_detection_enabled=current.ocr_turn_detection_enabled,
    )
    capabilities = ocr_service.capabilities(multipart_available=_is_multipart_available())
    reason_codes = ",".join(capabilities.reason_codes) or "unknown_reason"
    provider_label = current.ocr_provider
    if current.ocr_provider in {"google_vision", "tesseract"} and not capabilities.available:
        message = (
            f"OCR provider '{provider_label}' is configured but unavailable "
            f"(reasons={reason_codes})."
        )
        if current.is_production_env:
            errors.append(message)
        else:
            warnings.append(message)
    elif current.ocr_provider == "auto" and not capabilities.available:
        warnings.append(
            f"OCR auto mode has no available providers at startup (reasons={reason_codes})."
        )

    return errors, warnings


def validate_startup_or_raise(current: Settings) -> None:
    errors, warnings = validate_startup_settings(current)
    for warning in warnings:
        logger.warning("Startup warning: %s", warning)
    if errors:
        for error in errors:
            logger.error("Startup validation error: %s", error)
        formatted = "; ".join(errors)
        raise RuntimeError(f"Startup validation failed: {formatted}")


settings = get_settings()
