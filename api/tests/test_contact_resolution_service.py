import unittest

from repositories.in_memory_persistence import InMemoryPersistenceStore
from services.contact_resolution_service import ContactResolutionService


class TestContactResolutionService(unittest.TestCase):
    def setUp(self) -> None:
        self.store = InMemoryPersistenceStore()
        self.service = ContactResolutionService(self.store)

    def test_exact_contact_match(self):
        result = self.service.resolve(
            user_id="user-main",
            conversation_text="Yo: Hola\nEx Pareja: Te lei",
        )
        self.assertEqual(result.resolved_contact_id, "contact-ex")
        self.assertEqual(result.resolution_mode, "exact_match")
        self.assertEqual(result.owner_detected_name, "Yo")

    def test_unresolved_when_ambiguous_contacts(self):
        result = self.service.resolve(
            user_id="user-main",
            conversation_text="Ex Pareja: Hola\nColega: Te respondo",
        )
        self.assertIsNone(result.resolved_contact_id)
        self.assertEqual(result.resolution_mode, "unresolved")
        self.assertEqual(len(result.candidate_contacts), 2)

    def test_heuristic_when_no_match(self):
        result = self.service.resolve(
            user_id="user-main",
            conversation_text="Yo: Hola\nAna: Te respondo",
        )
        self.assertIsNone(result.resolved_contact_id)
        self.assertEqual(result.resolution_mode, "heuristic")

    def test_does_not_confuse_owner_name_as_contact(self):
        result = self.service.resolve(
            user_id="user-main",
            conversation_text="Martin: Hola\nColega: Te respondo",
        )
        self.assertEqual(result.resolved_contact_id, "contact-colleague")
        self.assertEqual(result.resolution_mode, "exact_match")


if __name__ == "__main__":
    unittest.main()
