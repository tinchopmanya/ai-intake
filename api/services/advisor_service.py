import json
import logging
from datetime import UTC
from datetime import datetime
from uuid import uuid4

from domain.entities import Advisor
from domain.entities import AdvisorOutput
from providers.base import AIProvider
from repositories.persistence import PersistenceStore
from schemas import AdvisorConversationHistoryResponse
from schemas import AdvisorRequest
from schemas import AdvisorResponse
from schemas import AdvisorResult
from schemas import Message
from services.advisor_committee_parser import parse_committee_response
from services.advisor_committee_prompt_builder import build_committee_prompt
from services.advisor_resolution_service import AdvisorResolutionService

logger = logging.getLogger(__name__)


class AdvisorService:
    def __init__(self, provider: AIProvider, store: PersistenceStore) -> None:
        self._provider = provider
        self._store = store
        self._resolver = AdvisorResolutionService(store)

    def advise(self, payload: AdvisorRequest) -> AdvisorResponse:
        conversation = self._store.ensure_conversation(
            conversation_id=payload.conversation_id,
            owner_user_id=payload.user_id,
            contact_id=payload.contact_id,
            channel="advisor",
        )
        self._store.append_message(
            conversation_id=conversation.id,
            role="user",
            message=self._build_session_input_message(payload),
            channel="advisor",
        )

        advisors = self._resolver.resolve_for_session(
            user_id=payload.user_id,
            contact_id=payload.contact_id,
            max_advisors=3,
        )
        if not advisors:
            fallback = self._store.get_advisor("laura")
            if fallback is not None:
                advisors = [fallback]

        prompt = self._build_prompt(advisors, payload.context, payload.conversation_text)

        try:
            # Mandatory architecture rule: exactly one Gemini call per advisor session.
            raw = self._provider.generate_answer(prompt)
        except Exception:
            logger.exception("Failed to generate advisor committee response")
            response = self._build_response_with_compat(
                self._build_global_fallback_response(advisors),
                conversation_id=conversation.id,
            )
            self._persist_outputs(payload, response)
            self._store.append_message(
                conversation_id=conversation.id,
                role="assistant",
                message=self._build_session_output_message(response),
                channel="advisor",
            )
            return response

        parsed = parse_committee_response(raw, advisors)
        if parsed is None:
            response = self._build_response_with_compat(
                self._build_global_fallback_response(advisors),
                conversation_id=conversation.id,
            )
            self._persist_outputs(payload, response)
            self._store.append_message(
                conversation_id=conversation.id,
                role="assistant",
                message=self._build_session_output_message(response),
                channel="advisor",
            )
            return response

        completed = self._complete_partial_response(parsed, advisors)
        response = self._build_response_with_compat(
            completed,
            conversation_id=conversation.id,
        )
        self._persist_outputs(payload, response)
        self._store.append_message(
            conversation_id=conversation.id,
            role="assistant",
            message=self._build_session_output_message(response),
            channel="advisor",
        )
        return response

    def get_conversation_history(
        self, conversation_id: str
    ) -> AdvisorConversationHistoryResponse | None:
        conversation = self._store.get_conversation(conversation_id)
        if conversation is None or conversation.channel != "advisor":
            return None

        messages = [
            Message(role=item.role, message=item.message, channel=item.channel)
            for item in self._store.get_conversation_messages(conversation_id)
        ]
        outputs = self._store.list_advisor_outputs(conversation_id)
        results: list[AdvisorResult] = []
        analysis: str | None = None
        for output in outputs:
            advisor = self._store.get_advisor(output.advisor_id)
            advisor_name = advisor.name if advisor is not None else output.advisor_id
            suggestions = json.loads(output.suggestions_json)
            if analysis is None:
                analysis = output.analysis_snapshot
            results.append(
                AdvisorResult(
                    advisor_id=output.advisor_id,
                    advisor_name=advisor_name,
                    suggestions=suggestions,
                )
            )

        return AdvisorConversationHistoryResponse(
            conversation_id=conversation_id,
            messages=messages,
            analysis=analysis,
            results=results,
        )

    def _build_session_input_message(self, payload: AdvisorRequest) -> str:
        context_text = payload.context.strip() or "Sin contexto adicional."
        return (
            "Entrada advisor:\n"
            f"Contexto: {context_text}\n"
            "Conversacion:\n"
            f"{payload.conversation_text.strip()}"
        )

    def _build_session_output_message(self, response: AdvisorResponse) -> str:
        return (
            "Salida advisor:\n"
            f"Analisis: {response.analysis}\n"
            f"Consejeros: {', '.join(result.advisor_name for result in response.results)}"
        )

    def _build_prompt(
        self, advisors: list[Advisor], context: str, conversation_text: str
    ) -> str:
        skills_by_advisor = {
            advisor.id: self._store.list_advisor_skills(advisor.id)
            for advisor in advisors
        }
        return build_committee_prompt(
            advisors=advisors,
            skills_by_advisor=skills_by_advisor,
            context=context,
            conversation_text=conversation_text,
        )

    def _complete_partial_response(
        self, parsed: AdvisorResponse, resolved_advisors: list[Advisor]
    ) -> AdvisorResponse:
        existing_map = {result.advisor_id: result for result in parsed.results}
        completed_results: list[AdvisorResult] = []
        for advisor in resolved_advisors:
            if advisor.id in existing_map:
                completed_results.append(existing_map[advisor.id])
            else:
                completed_results.append(self._fallback_result_for_advisor(advisor))

        return AdvisorResponse(
            conversation_id=parsed.conversation_id,
            analysis=parsed.analysis,
            results=completed_results,
        )

    def _build_global_fallback_response(self, advisors: list[Advisor]) -> AdvisorResponse:
        if not advisors:
            fallback = self._store.get_advisor("laura")
            if fallback is not None:
                advisors = [fallback]

        results = [self._fallback_result_for_advisor(advisor) for advisor in advisors]
        return AdvisorResponse(
            conversation_id="",
            analysis="No pude analizar la conversacion con precision en este momento.",
            results=results,
        )

    def _fallback_result_for_advisor(self, advisor: Advisor) -> AdvisorResult:
        fallback_by_advisor = {
            "laura": [
                "Entiendo como te sentis. Quiero que podamos hablar esto con calma.",
                "Me importa que nos escuchemos sin atacarnos para resolverlo mejor.",
            ],
            "robert": [
                "Podemos hablar, pero necesito que mantengamos el respeto.",
                "Quiero resolverlo, aunque voy a sostener mis limites con claridad.",
            ],
            "lidia": [
                "Propongo pausar, ordenar ideas y responder con foco en lo importante.",
            ],
        }
        suggestions = fallback_by_advisor.get(
            advisor.id,
            [
                "Gracias por compartirlo. Quiero responder con calma y respeto.",
            ],
        )
        return AdvisorResult(
            advisor_id=advisor.id,
            advisor_name=advisor.name,
            suggestions=suggestions[:2],
        )

    def _build_response_with_compat(
        self, response: AdvisorResponse, conversation_id: str
    ) -> AdvisorResponse:
        if not response.results:
            return AdvisorResponse(
                conversation_id=conversation_id,
                analysis=response.analysis,
                results=[],
            )

        first_result = response.results[0]
        main_suggestion = first_result.suggestions[0] if first_result.suggestions else None
        variants = [{"tone": "alternativa", "text": text} for text in first_result.suggestions]
        return AdvisorResponse(
            conversation_id=conversation_id,
            analysis=response.analysis,
            results=response.results,
            advisor_id=first_result.advisor_id,
            advisor_name=first_result.advisor_name,
            main_suggestion=main_suggestion,
            variants=variants,
        )

    def _persist_outputs(self, payload: AdvisorRequest, response: AdvisorResponse) -> None:
        for result in response.results:
            output = AdvisorOutput(
                id=str(uuid4()),
                conversation_id=response.conversation_id,
                owner_user_id=payload.user_id,
                contact_id=payload.contact_id,
                advisor_id=result.advisor_id,
                suggestions_json=json.dumps(result.suggestions),
                analysis_snapshot=response.analysis,
                created_at=datetime.now(UTC),
            )
            self._store.save_advisor_output(output)
