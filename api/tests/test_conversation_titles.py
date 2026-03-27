import unittest

from app.services.conversation_titles import get_safe_conversation_title


class TestConversationTitles(unittest.TestCase):
    def test_returns_limits_label_for_boundary_language(self):
        title = get_safe_conversation_title(
            source_text="Deja de escribirme por fuera de lo necesario.",
            analysis_summary="Hay presion y necesidad de marcar un limite.",
        )
        self.assertEqual(title, "Limites de comunicacion")

    def test_returns_family_label_for_children_context(self):
        title = get_safe_conversation_title(
            source_text="Hay que organizar el colegio y la vacuna de mi hijo.",
        )
        self.assertEqual(title, "Tema familiar")

    def test_returns_safe_fallback_when_signal_is_unclear(self):
        title = get_safe_conversation_title(
            source_text="No se bien que quiso decirme con eso.",
        )
        self.assertEqual(title, "Sin tema claro")


if __name__ == "__main__":
    unittest.main()
