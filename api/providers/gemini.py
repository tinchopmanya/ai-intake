import json
import logging
import time
from urllib import error
from urllib import parse
from urllib import request

from providers.base import AIProvider
from providers.base import AIProviderError

logger = logging.getLogger(__name__)

_DEFAULT_MAX_ATTEMPTS = 3
_DEFAULT_BASE_BACKOFF_SECONDS = 0.25


class GeminiAIProvider(AIProvider):
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float = 20,
        fallback_model: str | None = None,
        max_attempts: int = _DEFAULT_MAX_ATTEMPTS,
        base_backoff_seconds: float = _DEFAULT_BASE_BACKOFF_SECONDS,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._fallback_model = (fallback_model or "").strip() or None
        self._max_attempts = max(1, max_attempts)
        self._base_backoff_seconds = max(0.0, base_backoff_seconds)

    def generate_answer(self, message: str) -> str:
        fallback_source_error: AIProviderError | None = None
        try:
            return self._generate_with_retry(
                message,
                model=self._model,
                fallback_active=False,
            )
        except AIProviderError as exc:
            if not self._should_use_fallback(exc):
                logger.warning(
                    "gemini_fallback_skipped primary_model=%s fallback_used=no status_code=%s provider_code=%s",
                    self._model,
                    exc.status_code,
                    exc.provider_code,
                )
                raise
            fallback_source_error = exc

        assert self._fallback_model is not None
        assert fallback_source_error is not None
        logger.warning(
            "gemini_fallback_start primary_model=%s fallback_model=%s status_code=%s provider_code=%s",
            self._model,
            self._fallback_model,
            fallback_source_error.status_code,
            fallback_source_error.provider_code,
        )
        return self._generate_with_retry(
            message,
            model=self._fallback_model,
            fallback_active=True,
        )

    def _generate_with_retry(
        self,
        message: str,
        *,
        model: str,
        fallback_active: bool,
    ) -> str:
        last_error: AIProviderError | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                response_body = self._request_content(message, model=model)
                return self._extract_answer(response_body, model=model)
            except AIProviderError as exc:
                last_error = exc
                logger.warning(
                    "gemini_request_failed attempt=%s/%s status_code=%s provider_code=%s model=%s fallback_used=%s retryable=%s",
                    attempt,
                    self._max_attempts,
                    exc.status_code,
                    exc.provider_code,
                    model,
                    "yes" if fallback_active else "no",
                    exc.retryable,
                )
                if not self._should_retry(exc, attempt=attempt):
                    raise
                backoff_seconds = self._base_backoff_seconds * (2 ** (attempt - 1))
                logger.info(
                    "gemini_retry_scheduled attempt=%s/%s status_code=%s model=%s fallback_used=%s backoff_seconds=%.2f",
                    attempt,
                    self._max_attempts,
                    exc.status_code,
                    model,
                    "yes" if fallback_active else "no",
                    backoff_seconds,
                )
                time.sleep(backoff_seconds)

        if last_error is not None:
            raise last_error
        raise AIProviderError(
            "Gemini request failed without a captured provider error",
            provider_name="gemini",
            model=model,
        )

    def _request_content(self, message: str, *, model: str) -> str:
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={parse.quote(self._api_key)}"
        )

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": message}],
                }
            ]
        }
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            endpoint,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=self._timeout_seconds) as response:
                return response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            error_payload = _parse_gemini_error_payload(detail)
            provider_code = error_payload.get("status")
            message_text = error_payload.get("message") or f"Gemini HTTP error: {exc.code}"
            raise AIProviderError(
                message_text,
                status_code=exc.code,
                provider_code=provider_code,
                retryable=_is_high_demand_error(
                    status_code=exc.code,
                    provider_code=provider_code,
                ),
                provider_name="gemini",
                model=model,
            ) from exc
        except error.URLError as exc:
            raise AIProviderError(
                f"Gemini request failed: {exc.reason}",
                provider_name="gemini",
                model=model,
            ) from exc

    def _extract_answer(self, response_body: str, *, model: str) -> str:
        try:
            data = json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise AIProviderError(
                "Gemini returned invalid JSON",
                provider_name="gemini",
                model=model,
            ) from exc

        if "error" in data:
            error_payload = data["error"] if isinstance(data["error"], dict) else {}
            provider_code = str(error_payload.get("status") or "").strip() or None
            status_code = _coerce_int(error_payload.get("code"))
            message_text = str(error_payload.get("message") or "Unknown Gemini error")
            raise AIProviderError(
                message_text,
                status_code=status_code,
                provider_code=provider_code,
                retryable=_is_high_demand_error(
                    status_code=status_code,
                    provider_code=provider_code,
                ),
                provider_name="gemini",
                model=model,
            )

        candidates = data.get("candidates") or []
        if not candidates:
            prompt_feedback = data.get("promptFeedback", {})
            block_reason = prompt_feedback.get("blockReason")
            if block_reason:
                raise AIProviderError(
                    f"Gemini blocked prompt: {block_reason}",
                    provider_name="gemini",
                    model=model,
                )
            raise AIProviderError(
                "Gemini returned no candidates",
                provider_name="gemini",
                model=model,
            )

        first_candidate = candidates[0]
        parts = first_candidate.get("content", {}).get("parts", [])
        text_parts = [part.get("text", "") for part in parts if part.get("text")]
        answer = "\n".join(text_parts).strip()
        if not answer:
            finish_reason = first_candidate.get("finishReason")
            if finish_reason:
                raise AIProviderError(
                    f"Gemini returned empty text (finishReason={finish_reason})",
                    provider_name="gemini",
                    model=model,
                )
            raise AIProviderError(
                "Gemini returned empty text",
                provider_name="gemini",
                model=model,
            )
        return answer

    def _should_retry(self, exc: AIProviderError, *, attempt: int) -> bool:
        return exc.retryable and attempt < self._max_attempts

    def _should_use_fallback(self, exc: AIProviderError) -> bool:
        return (
            self._fallback_model is not None
            and self._fallback_model != self._model
            and _is_high_demand_error(
                status_code=exc.status_code,
                provider_code=exc.provider_code,
            )
        )


def _parse_gemini_error_payload(detail: str) -> dict[str, str | None]:
    try:
        payload = json.loads(detail)
    except json.JSONDecodeError:
        return {"message": detail.strip() or None, "status": None}
    if not isinstance(payload, dict):
        return {"message": detail.strip() or None, "status": None}
    error_payload = payload.get("error")
    if not isinstance(error_payload, dict):
        return {"message": detail.strip() or None, "status": None}
    return {
        "message": str(error_payload.get("message") or "").strip() or None,
        "status": str(error_payload.get("status") or "").strip() or None,
    }


def _coerce_int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _is_high_demand_error(*, status_code: int | None, provider_code: str | None) -> bool:
    normalized_provider_code = (provider_code or "").strip().upper()
    return status_code == 503 or normalized_provider_code == "UNAVAILABLE"
