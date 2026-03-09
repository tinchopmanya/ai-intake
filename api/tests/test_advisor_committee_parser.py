import unittest

from domain.entities import Advisor
from services.advisor_committee_parser import parse_committee_response


def _advisors() -> list[Advisor]:
    return [
        Advisor("laura", "Laura", "Psicologa", "", "base"),
        Advisor("robert", "Robert", "Abogado", "", "base"),
        Advisor("lidia", "Lidia", "Coach", "", "base"),
    ]


class TestAdvisorCommitteeParser(unittest.TestCase):
    def test_parse_valid_complete_json(self):
        raw = (
            '{"analysis":"ok","results":['
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":["a","b"]},'
            '{"advisor_id":"robert","advisor_name":"Robert","suggestions":["a"]}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(len(parsed.results), 2)

    def test_parse_valid_partial_json(self):
        raw = (
            '{"analysis":"ok","results":['
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":["a"]}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual([result.advisor_id for result in parsed.results], ["laura"])

    def test_parse_discards_duplicated_advisor_id(self):
        raw = (
            '{"analysis":"ok","results":['
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":["a"]},'
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":["b"]}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(len(parsed.results), 1)

    def test_parse_discards_unresolved_advisor_id(self):
        raw = (
            '{"analysis":"ok","results":['
            '{"advisor_id":"ghost","advisor_name":"Ghost","suggestions":["a"]},'
            '{"advisor_id":"robert","advisor_name":"Robert","suggestions":["b"]}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual([result.advisor_id for result in parsed.results], ["robert"])

    def test_parse_invalid_when_suggestions_empty(self):
        raw = (
            '{"analysis":"ok","results":['
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":[]}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNone(parsed)

    def test_parse_invalid_when_suggestions_not_list(self):
        raw = (
            '{"analysis":"ok","results":['
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":"x"}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNone(parsed)

    def test_parse_invalid_json(self):
        parsed = parse_committee_response("not json", _advisors())
        self.assertIsNone(parsed)

    def test_parse_wrapped_json_fence(self):
        raw = (
            "```json\n"
            '{"analysis":"ok","results":['
            '{"advisor_id":"laura","advisor_name":"Laura","suggestions":["a"]}'
            "]}\n"
            "```"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.results[0].advisor_id, "laura")

    def test_parse_valid_perspectives_shape(self):
        raw = (
            '{"analysis":"ok","perspectives":['
            '{"advisor":"Laura","reflection":"r1","suggested_reply":"s1"},'
            '{"advisor":"Robert","reflection":"r2","suggested_reply":"s2"}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual([result.advisor_id for result in parsed.results], ["laura", "robert"])
        self.assertEqual(parsed.results[0].suggestions[0], "s1")
        self.assertTrue(parsed.results[0].suggestions[1].startswith("Reflexion: "))

    def test_parse_perspectives_discards_unknown_advisor(self):
        raw = (
            '{"analysis":"ok","perspectives":['
            '{"advisor":"Ghost","reflection":"r1","suggested_reply":"s1"},'
            '{"advisor":"Lidia","reflection":"r2","suggested_reply":"s2"}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual([result.advisor_id for result in parsed.results], ["lidia"])

    def test_parse_perspectives_requires_suggested_reply(self):
        raw = (
            '{"analysis":"ok","perspectives":['
            '{"advisor":"Laura","reflection":"r1","suggested_reply":""}'
            "]}"
        )
        parsed = parse_committee_response(raw, _advisors())
        self.assertIsNone(parsed)


if __name__ == "__main__":
    unittest.main()
