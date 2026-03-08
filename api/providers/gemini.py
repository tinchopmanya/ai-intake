import json
from urllib import error
from urllib import parse
from urllib import request

from providers.base import AIProvider
from providers.base import AIProviderError


class GeminiAIProvider(AIProvider):
    def __init__(self, api_key: str, model: str, timeout_seconds: float = 20) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds

    def generate_answer(self, message: str) -> str:
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._model}:generateContent?key={parse.quote(self._api_key)}"
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
                response_body = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise AIProviderError(f"Gemini HTTP error: {exc.code} {detail}") from exc
        except error.URLError as exc:
            raise AIProviderError(f"Gemini request failed: {exc.reason}") from exc

        try:
            data = json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise AIProviderError("Gemini returned invalid JSON") from exc

        if "error" in data:
            message_text = data["error"].get("message", "Unknown Gemini error")
            raise AIProviderError(message_text)

        candidates = data.get("candidates") or []
        if not candidates:
            prompt_feedback = data.get("promptFeedback", {})
            block_reason = prompt_feedback.get("blockReason")
            if block_reason:
                raise AIProviderError(f"Gemini blocked prompt: {block_reason}")
            raise AIProviderError("Gemini returned no candidates")

        first_candidate = candidates[0]
        parts = first_candidate.get("content", {}).get("parts", [])
        text_parts = [part.get("text", "") for part in parts if part.get("text")]
        answer = "\n".join(text_parts).strip()
        if not answer:
            finish_reason = first_candidate.get("finishReason")
            if finish_reason:
                raise AIProviderError(
                    f"Gemini returned empty text (finishReason={finish_reason})"
                )
            raise AIProviderError("Gemini returned empty text")
        return answer
