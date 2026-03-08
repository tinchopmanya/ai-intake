from providers.base import AIProvider


UNCONFIGURED_PROVIDER_MESSAGE = (
    "Gemini no esta configurado. Define GEMINI_API_KEY para habilitar respuestas con IA."
)


class UnconfiguredAIProvider(AIProvider):
    def generate_answer(self, message: str) -> str:
        return UNCONFIGURED_PROVIDER_MESSAGE
