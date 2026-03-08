import json
import logging

from providers.base import AIProvider
from schemas import AdvisorRequest
from schemas import AdvisorResponse

logger = logging.getLogger(__name__)


class AdvisorService:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def advise(self, payload: AdvisorRequest) -> AdvisorResponse:
        prompt = self._build_prompt(payload)

        try:
            raw_answer = self._provider.generate_answer(prompt, "emotional_advisor")
        except Exception:
            logger.exception("Failed to generate advisor response")
            return AdvisorResponse(
                analysis="No pude analizar la conversacion en este momento.",
                suggestions=[
                    "Podrias intentar responder con calma y pedir unos minutos para pensar.",
                ],
            )

        return self._parse_response(raw_answer)

    def _build_prompt(self, payload: AdvisorRequest) -> str:
        context_text = payload.context.strip() or "Sin contexto adicional."
        tone_text = payload.tone.strip() or "empathetic"
        return (
            "Analiza brevemente la conversacion y propone respuestas sugeridas.\n"
            "Responde SOLO en JSON valido con esta estructura:\n"
            '{"analysis":"...","suggestions":["...","...","..."]}\n\n'
            f"Tono deseado: {tone_text}\n"
            f"Contexto opcional: {context_text}\n\n"
            "Conversacion:\n"
            f"{payload.conversation_text.strip()}"
        )

    def _parse_response(self, raw_answer: str) -> AdvisorResponse:
        cleaned = raw_answer.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json\n", "", 1).strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return AdvisorResponse(
                analysis="Analisis generado por IA.",
                suggestions=[raw_answer.strip()],
            )

        analysis = data.get("analysis")
        suggestions = data.get("suggestions")
        if not isinstance(analysis, str):
            analysis = "Analisis generado por IA."
        if not isinstance(suggestions, list):
            suggestions = []

        parsed_suggestions = [
            item.strip() for item in suggestions if isinstance(item, str) and item.strip()
        ]
        if not parsed_suggestions:
            parsed_suggestions = ["No pude generar variantes claras. Intenta reformular."]

        return AdvisorResponse(analysis=analysis.strip(), suggestions=parsed_suggestions[:3])
