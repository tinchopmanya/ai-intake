import unittest
from uuid import UUID

from app.services.auth_service import AuthenticatedUser
from app.services.safe_memory import SafeMemoryService
from app.services.safe_memory import sanitize_for_safe_memory


class FailingProvider:
    def generate_answer(self, message: str) -> str:
        raise RuntimeError("provider unavailable")


class TestSafeMemoryService(unittest.TestCase):
    def setUp(self) -> None:
        self.current_user = AuthenticatedUser(
            id=UUID("00000000-0000-0000-0000-000000000201"),
            email="memory@example.com",
            name="Memory User",
            memory_opt_in=False,
            locale="es-UY",
            picture_url=None,
            country_code="UY",
            language_code="es",
            onboarding_completed=True,
            relationship_mode="coparenting",
            ex_partner_name="Martin",
            children_count_category="one",
        )

    def test_sanitize_for_safe_memory_replaces_known_aliases_and_sensitive_tokens(self):
        sanitized = sanitize_for_safe_memory(
            source_text=(
                "Martin dijo que llame al 099 123 456 y vaya a Escuela Horizonte, "
                "ademas menciono la direccion Calle Falsa 1234."
            ),
            current_user=self.current_user,
        )

        self.assertIn("@expareja", sanitized.sanitized_text)
        self.assertIn("@telefono", sanitized.sanitized_text)
        self.assertIn("escuela @institucion", sanitized.sanitized_text.lower())
        self.assertIn("@direccion", sanitized.sanitized_text)
        self.assertNotIn("Martin", sanitized.sanitized_text)

    def test_build_exchange_memory_uses_safe_fallback_when_model_fails(self):
        service = SafeMemoryService(FailingProvider())

        result = service.build_exchange_memory(
            source_text="Martin pide coordinar el retiro del hijo y menciona un conflicto por horarios.",
            analysis_summary="Hay tension y necesidad de mantener foco logistico.",
            current_user=self.current_user,
            source_kind="ex_chat_pasted",
        )

        self.assertEqual(result.memory_type, "coparenting_exchange_summary")
        self.assertNotIn("Martin", result.safe_title)
        self.assertNotIn("Martin", result.safe_summary)
        self.assertIn(result.risk_level, {"low", "moderate", "high", "sensitive"})


if __name__ == "__main__":
    unittest.main()
