import json
import unittest
from dataclasses import replace
from datetime import UTC
from datetime import datetime

from domain.entities import AdvisorOutput
from repositories.in_memory_persistence import InMemoryPersistenceStore
from services.contact_history_context_service import ContactHistoryContextService


class TestContactHistoryContextService(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryPersistenceStore()
        self.service = ContactHistoryContextService(self.store)

    def _seed_session_output(
        self, conversation_id: str, analysis: str, suggestions: list[str]
    ) -> None:
        self.store.ensure_conversation(
            conversation_id=conversation_id,
            owner_user_id="user-main",
            contact_id="contact-ex",
            channel="advisor",
        )
        self.store.save_advisor_output(
            AdvisorOutput(
                id=f"out-{conversation_id}",
                conversation_id=conversation_id,
                owner_user_id="user-main",
                contact_id="contact-ex",
                advisor_id="laura",
                suggestions_json=json.dumps(suggestions),
                analysis_snapshot=analysis,
                created_at=datetime.now(UTC),
            )
        )

    def test_build_for_prompt_returns_none_without_history_or_profile(self):
        self.store.contacts["contact-ex"] = replace(
            self.store.contacts["contact-ex"],
            profile_summary=None,
        )
        context = self.service.build_for_prompt(
            user_id="user-main",
            contact_id="contact-ex",
            current_conversation_id="current",
        )
        self.assertIsNone(context)

    def test_build_for_prompt_includes_profile_and_previous_outputs(self):
        self._seed_session_output(
            conversation_id="prev-1",
            analysis="Analisis previo util.",
            suggestions=["Respira y responde con calma."],
        )
        context = self.service.build_for_prompt(
            user_id="user-main",
            contact_id="contact-ex",
            current_conversation_id="current",
        )
        self.assertIsNotNone(context)
        assert context is not None
        self.assertIn("Perfil conocido del contacto:", context.history_block)
        self.assertIn("Analisis previo util.", context.history_block)
        self.assertIn("Respira y responde con calma.", context.history_block)

    def test_build_for_prompt_respects_limits_and_truncates(self):
        for index in range(6):
            self._seed_session_output(
                conversation_id=f"prev-{index}",
                analysis=f"Analisis {index} " + ("largo " * 30),
                suggestions=[f"Sugerencia {index}-a", f"Sugerencia {index}-b"],
            )
        context = self.service.build_for_prompt(
            user_id="user-main",
            contact_id="contact-ex",
            current_conversation_id="current",
        )
        self.assertIsNotNone(context)
        assert context is not None
        self.assertLessEqual(len(context.history_block), self.service.MAX_BLOCK_CHARS)
        self.assertLessEqual(context.sessions_used, self.service.MAX_SESSIONS)
        self.assertLessEqual(context.suggestions_used, self.service.MAX_SUGGESTIONS)

    def test_build_for_prompt_ignores_current_conversation(self):
        self._seed_session_output(
            conversation_id="current",
            analysis="No debe entrar",
            suggestions=["No incluir"],
        )
        context = self.service.build_for_prompt(
            user_id="user-main",
            contact_id="contact-ex",
            current_conversation_id="current",
        )
        self.assertIsNotNone(context)
        assert context is not None
        self.assertNotIn("No debe entrar", context.history_block)


if __name__ == "__main__":
    unittest.main()
