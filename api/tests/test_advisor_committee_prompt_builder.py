import unittest

from domain.entities import Advisor
from domain.entities import Skill
from services.advisor_committee_prompt_builder import build_committee_prompt


def _advisor(advisor_id: str) -> Advisor:
    return Advisor(
        id=advisor_id,
        name=advisor_id.capitalize(),
        role="Rol",
        description="desc",
        system_prompt_base=f"Base prompt {advisor_id}",
    )


def _skill(skill_id: str) -> Skill:
    return Skill(
        id=skill_id,
        name=skill_id,
        type="trait",
        category="tone",
        is_system=True,
        prompt_snippet=f"snippet-{skill_id}",
    )


class TestAdvisorCommitteePromptBuilder(unittest.TestCase):
    def test_build_prompt_with_one_advisor(self):
        advisor = _advisor("laura")
        prompt = build_committee_prompt(
            advisors=[advisor],
            skills_by_advisor={"laura": [_skill("a")]},
            context="ctx",
            conversation_text="conv",
        )
        self.assertIn("PERFIL 1: Laura - Rol (laura)", prompt)
        self.assertNotIn("PERFIL 2:", prompt)

    def test_build_prompt_with_two_advisors(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura"), _advisor("robert")],
            skills_by_advisor={},
            context="ctx",
            conversation_text="conv",
        )
        self.assertIn("PERFIL 1: Laura - Rol (laura)", prompt)
        self.assertIn("PERFIL 2: Robert - Rol (robert)", prompt)
        self.assertNotIn("PERFIL 3:", prompt)

    def test_build_prompt_with_three_advisors(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura"), _advisor("robert"), _advisor("lidia")],
            skills_by_advisor={},
            context="ctx",
            conversation_text="conv",
        )
        self.assertIn("PERFIL 1: Laura - Rol (laura)", prompt)
        self.assertIn("PERFIL 2: Robert - Rol (robert)", prompt)
        self.assertIn("PERFIL 3: Lidia - Rol (lidia)", prompt)

    def test_build_prompt_without_skills(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={"laura": []},
            context="ctx",
            conversation_text="conv",
        )
        self.assertIn("- Sin skills adicionales.", prompt)

    def test_build_prompt_limits_skills_to_eight(self):
        skills = [_skill(str(index)) for index in range(10)]
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={"laura": skills},
            context="ctx",
            conversation_text="conv",
        )
        self.assertEqual(prompt.count("snippet-"), 8)

    def test_build_prompt_with_empty_context(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={},
            context="",
            conversation_text="conv",
        )
        self.assertIn("Sin contexto adicional.", prompt)

    def test_build_prompt_includes_json_output_instruction(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={},
            context="ctx",
            conversation_text="conv",
        )
        self.assertIn("FORMATO DE RESPUESTA (JSON estricto", prompt)
        self.assertIn('"results"', prompt)

    def test_build_prompt_delimits_user_data(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={},
            context="ctx",
            conversation_text="conv",
        )
        self.assertIn("[INICIO_CONVERSACION]", prompt)
        self.assertIn("[FIN_CONVERSACION]", prompt)
        self.assertIn("[INICIO_CONTEXTO]", prompt)
        self.assertIn("[FIN_CONTEXTO]", prompt)

    def test_build_prompt_includes_contact_history_block_when_provided(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={},
            context="ctx",
            conversation_text="conv",
            contact_history_context="historial breve",
        )
        self.assertIn("[INICIO_HISTORIAL_CONTACTO]", prompt)
        self.assertIn("historial breve", prompt)
        self.assertIn("[FIN_HISTORIAL_CONTACTO]", prompt)

    def test_build_prompt_skips_contact_history_block_when_missing(self):
        prompt = build_committee_prompt(
            advisors=[_advisor("laura")],
            skills_by_advisor={},
            context="ctx",
            conversation_text="conv",
            contact_history_context=None,
        )
        self.assertNotIn("[INICIO_HISTORIAL_CONTACTO]", prompt)


if __name__ == "__main__":
    unittest.main()
