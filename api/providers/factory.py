from config import settings
from providers.base import AIProvider
from providers.fallback import UnconfiguredAIProvider
from providers.gemini import GeminiAIProvider


def build_provider() -> AIProvider:
    if not settings.gemini_api_key:
        return UnconfiguredAIProvider()
    return GeminiAIProvider(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        timeout_seconds=settings.gemini_timeout_seconds,
    )
