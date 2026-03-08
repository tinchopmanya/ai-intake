import json
import logging

from providers.base import AIProvider
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from schemas import AdvisorVariant

logger = logging.getLogger(__name__)

SUPPORTED_TONES = ["empathetic", "firm", "brief", "warm"]


class AdvisorService:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def advise(self, payload: AdvisorRequest) -> AdvisorResponse:
        tone = payload.tone if payload.tone in SUPPORTED_TONES else "empathetic"
        prompt = self._build_prompt(payload.conversation_text, payload.context, tone)

        try:
            raw = self._provider.generate_answer(prompt)
        except Exception:
            logger.exception("Failed to generate advisor response")
            return self._fallback_response()

        parsed = self._parse_json_response(raw)
        if parsed is None:
            return self._fallback_response(raw_text=raw)
        return parsed

    def _build_prompt(self, conversation_text: str, context: str, tone: str) -> str:
        safe_context = context.strip() or "Sin contexto adicional."
        return (
            "Eres un consejero emocional practico. "
            "Analiza una conversacion y sugiere respuestas.\n"
            "Responde EXCLUSIVAMENTE en JSON valido con esta estructura exacta:\n"
            '{"analysis":"...",'
            '"main_suggestion":"...",'
            '"variants":[{"tone":"empathetic","text":"..."},{"tone":"firm","text":"..."},'
            '{"tone":"brief","text":"..."}]}\n'
            "Reglas:\n"
            "- analysis: 1-3 frases breves.\n"
            "- main_suggestion: 1 respuesta lista para enviar.\n"
            "- variants: entre 2 y 3 variantes con tonos de esta lista: empathetic, firm, brief, warm.\n"
            f"- Prioriza como tono principal: {tone}.\n\n"
            f"Contexto: {safe_context}\n"
            "Conversacion:\n"
            f"{conversation_text.strip()}"
        )

    def _parse_json_response(self, raw: str) -> AdvisorResponse | None:
        text = raw.strip()
        if text.startswith("```"):
            text = text.replace("```json", "").replace("```", "").strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None

        analysis = data.get("analysis")
        main_suggestion = data.get("main_suggestion")
        variants = data.get("variants")

        if not isinstance(analysis, str) or not isinstance(main_suggestion, str):
            return None
        if not isinstance(variants, list):
            return None

        parsed_variants: list[AdvisorVariant] = []
        for item in variants:
            if not isinstance(item, dict):
                continue
            tone = item.get("tone")
            text_value = item.get("text")
            if not isinstance(tone, str) or not isinstance(text_value, str):
                continue
            tone_clean = tone.strip()
            text_clean = text_value.strip()
            if not tone_clean or not text_clean:
                continue
            parsed_variants.append(AdvisorVariant(tone=tone_clean, text=text_clean))

        if len(parsed_variants) < 2:
            return None

        return AdvisorResponse(
            analysis=analysis.strip(),
            main_suggestion=main_suggestion.strip(),
            variants=parsed_variants[:3],
        )

    def _fallback_response(self, raw_text: str | None = None) -> AdvisorResponse:
        return AdvisorResponse(
            analysis="No pude analizar la conversacion con precision en este momento.",
            main_suggestion=(
                "Gracias por compartirlo. Quiero responder con calma y respeto. "
                "Podemos hablarlo con tranquilidad?"
            ),
            variants=[
                AdvisorVariant(
                    tone="empathetic",
                    text="Entiendo como te sentis. Me importa hablarlo bien y con respeto.",
                ),
                AdvisorVariant(
                    tone="firm",
                    text="Quiero conversar, pero necesito que lo hagamos sin agresiones.",
                ),
                AdvisorVariant(
                    tone="brief",
                    text="Hablemos con calma. Quiero resolverlo bien.",
                ),
            ],
        )
