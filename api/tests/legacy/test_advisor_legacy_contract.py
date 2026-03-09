import unittest


@unittest.skip("Legacy advisor contract kept only for reference; MVP uses session_id/responses/persistence")
class TestAdvisorLegacyContract(unittest.TestCase):
    def test_legacy_contract_shape(self):
        pass

    def test_legacy_conversation_endpoints(self):
        pass

    def test_legacy_contact_resolution_assertions(self):
        pass


if __name__ == "__main__":
    unittest.main()

