import json
import logging
from datetime import UTC
from datetime import datetime
from uuid import uuid4

from domain.entities import Advisor
from domain.entities import AdvisorOutput
from providers.base import AIProvider
from repositories.persistence import PersistenceStore
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from schemas import AdvisorVariant
from services.advisor_resolution_service import AdvisorResolutionService

logger = logging.getLogger(__name__)

SUPPORTED_TONES = ["empathetic", "firm", "brief", "warm"]

TONE_GUIDELINES = {
    "empathetic": "Valida emociones y responde con cuidado humano.",
    "firm": "Marca limites claros con respeto y sin agresion.",
    "brief": "Mantiene respuestas cortas y concretas.",
    "warm": "Tono cercano, amable y contenedor.",
}


class AdvisorService:
    def __init__(self, provider: AIProvider, store: PersistenceStore) -> None:
        self._provider = provider
        self._store = store
        self._resolver = AdvisorResolutionService(store)

    def advise(self, payload: AdvisorRequest) -> AdvisorResponse:
        tone = payload.tone if payload.tone in SUPPORTED_TONES else "empathetic"
        advisor = self._select_advisor(payload)

        prompt = self._build_prompt(
            advisor=advisor,
            tone=tone,
            context=payload.context,
            conversation_text=payload.conversation_text,
        )

        try:
            # Design decision: keep a single Gemini call per advisor session.
            raw = self._provider.generate_answer(prompt)
        except Exception:
            logger.exception("Failed to generate advisor response")
            response = self._fallback_response(advisor)
            self._save_output(payload, advisor, tone, response)
            return response

        parsed = self._parse_json_response(raw, advisor)
        if parsed is None:
            response = self._fallback_response(advisor)
            self._save_output(payload, advisor, tone, response)
            return response

        self._save_output(payload, advisor, tone, parsed)
        return parsed

    def _select_advisor(self, payload: AdvisorRequest) -> Advisor:
        if payload.advisor_id:
            selected = self._store.get_advisor(payload.advisor_id)
            if selected is not None:
                return selected

        resolved = self._resolver.resolve_for_session(
            user_id=payload.user_id,
            contact_id=payload.contact_id,
            max_advisors=3,
        )
        if resolved:
            return resolved[0]

        fallback = self._store.get_advisor("laura")
        if fallback is None:
            raise RuntimeError("Advisor catalog is not initialized")
        return fallback

    def _build_prompt(
        self, advisor: Advisor, tone: str, context: str, conversation_text: str
    ) -> str:
        safe_context = context.strip() or "Sin contexto adicional."
        tone_instruction = TONE_GUIDELINES[tone]
        skills = self._store.list_advisor_skills(advisor.id)

        skills_block = ""
        if skills:
            snippets = "\n".join(f"- {skill.prompt_snippet}" for skill in skills)
            skills_block = f"Habilidades activas:\n{snippets}\n\n"

        return (
            "Eres un consejero emocional especializado.\n"
            f"Perfil seleccionado: {advisor.name} ({advisor.role}) [{advisor.id}].\n"
            f"Prompt base del perfil:\n{advisor.system_prompt_base}\n\n"
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
            "- variants: entre 2 y 3 variantes con tonos: empathetic, firm, brief, warm.\n"
            f"- Debes incluir una variante con tono {tone}.\n\n"
            f"Contexto: {safe_context}\n"
            "Conversacion:\n"
            f"{conversation_text.strip()}"
        )

    def _parse_json_response(self, raw: str, advisor: Advisor) -> AdvisorResponse | None:
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
            advisor_id=advisor.id,
            advisor_name=advisor.name,
            analysis=analysis.strip(),
            main_suggestion=main_suggestion.strip(),
            variants=parsed_variants[:3],
        )

    def _fallback_response(self, advisor: Advisor) -> AdvisorResponse:
        return AdvisorResponse(
            advisor_id=advisor.id,
            advisor_name=advisor.name,
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

    def _save_output(
        self,
        payload: AdvisorRequest,
        advisor: Advisor,
        tone: str,
        response: AdvisorResponse,
    ) -> None:
        output = AdvisorOutput(
            id=str(uuid4()),
            owner_user_id=payload.user_id,
            contact_id=payload.contact_id,
            advisor_id=advisor.id,
            tone=tone,
            analysis=response.analysis,
            main_suggestion=response.main_suggestion,
            variants_json=json.dumps([variant.model_dump() for variant in response.variants]),
            created_at=datetime.now(UTC),
        )
        self._store.save_advisor_output(output)
