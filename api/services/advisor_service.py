import json
import logging

from providers.base import AIProvider
from repositories.in_memory_advisor_catalog import get_advisor_profile
from repositories.in_memory_advisor_catalog import get_advisor_skills
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from schemas import AdvisorVariant

logger = logging.getLogger(__name__)

SUPPORTED_TONES = ["empathetic", "firm", "brief", "warm"]

TONE_GUIDELINES = {
    "empathetic": "Valida emociones y responde con cuidado humano.",
    "firm": "Marca limites claros, con respeto y sin agresion.",
    "brief": "Respuestas cortas y directas, maximo 2-3 frases.",
    "warm": "Tono cercano, amable y contenedor.",
}


class AdvisorService:
    def __init__(self, provider: AIProvider) -> None:
        self._provider = provider

    def advise(self, payload: AdvisorRequest) -> AdvisorResponse:
        advisor = get_advisor_profile(payload.advisor_id)
        skills = get_advisor_skills(advisor.id)
        tone = payload.tone if payload.tone in SUPPORTED_TONES else "empathetic"
        prompt = self._build_prompt(
            advisor_id=advisor.id,
            advisor_name=advisor.name,
            advisor_role=advisor.role,
            advisor_base_prompt=advisor.system_prompt_base,
            skill_snippets=[skill.prompt_snippet for skill in skills],
            tone=tone,
            context=payload.context,
            conversation_text=payload.conversation_text,
        )

        try:
            # Keep a single Gemini call per advisor session.
            raw = self._provider.generate_answer(prompt)
        except Exception:
            logger.exception("Failed to generate advisor response")
            return self._fallback_response(advisor.id, advisor.name)

        parsed = self._parse_json_response(raw, advisor.id, advisor.name)
        if parsed is None:
            return self._fallback_response(advisor.id, advisor.name)
        return parsed

    def _build_prompt(
        self,
        advisor_id: str,
        advisor_name: str,
        advisor_role: str,
        advisor_base_prompt: str,
        skill_snippets: list[str],
        tone: str,
        context: str,
        conversation_text: str,
    ) -> str:
        safe_context = context.strip() or "Sin contexto adicional."
        tone_instruction = TONE_GUIDELINES[tone]
        skills_block = ""
        if skill_snippets:
            bullet_list = "\n".join(f"- {snippet}" for snippet in skill_snippets)
            skills_block = f"Habilidades activas:\n{bullet_list}\n"

        return (
            "Eres un consejero emocional especializado. "
            "Responde en espanol neutro y util para enviar por chat.\n"
            f"Perfil seleccionado: {advisor_name} ({advisor_role}) [{advisor_id}].\n"
            f"Prompt base del perfil:\n{advisor_base_prompt}\n\n"
            f"{skills_block}"
            f"Tono principal solicitado: {tone}. {tone_instruction}\n\n"
            "Responde EXCLUSIVAMENTE en JSON valido con esta estructura exacta:\n"
            '{"analysis":"...",'
            '"main_suggestion":"...",'
            '"variants":[{"tone":"empathetic","text":"..."},{"tone":"firm","text":"..."},'
            '{"tone":"brief","text":"..."}]}\n\n'
            "Reglas:\n"
            "- analysis: 1-3 frases breves.\n"
            "- main_suggestion: 1 respuesta lista para enviar.\n"
            "- variants: entre 2 y 3 variantes con tonos de esta lista: empathetic, firm, brief, warm.\n"
            f"- Debes incluir una variante con el tono principal {tone}.\n\n"
            f"Contexto: {safe_context}\n"
            "Conversacion:\n"
            f"{conversation_text.strip()}"
        )

    def _parse_json_response(
        self, raw: str, advisor_id: str, advisor_name: str
    ) -> AdvisorResponse | None:
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
            advisor_id=advisor_id,
            advisor_name=advisor_name,
            analysis=analysis.strip(),
            main_suggestion=main_suggestion.strip(),
            variants=parsed_variants[:3],
        )

    def _fallback_response(self, advisor_id: str, advisor_name: str) -> AdvisorResponse:
        return AdvisorResponse(
            advisor_id=advisor_id,
            advisor_name=advisor_name,
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
