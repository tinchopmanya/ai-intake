import json

from domain.entities import Advisor
from schemas import AdvisorResponse
from schemas import AdvisorResult


def parse_committee_response(
    raw: str, resolved_advisors: list[Advisor]
) -> AdvisorResponse | None:
    text = raw.strip()
    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None

    analysis = data.get("analysis")
    raw_results = data.get("results")
    if not isinstance(analysis, str) or not isinstance(raw_results, list):
        return None

    allowed_ids = {advisor.id for advisor in resolved_advisors}
    advisor_name_map = {advisor.id: advisor.name for advisor in resolved_advisors}
    seen_ids: set[str] = set()
    validated_results: list[AdvisorResult] = []

    for item in raw_results:
        if not isinstance(item, dict):
            continue

        advisor_id = item.get("advisor_id")
        suggestions = item.get("suggestions")
        if not isinstance(advisor_id, str) or advisor_id not in allowed_ids:
            continue
        if advisor_id in seen_ids:
            continue
        if not isinstance(suggestions, list):
            continue

        cleaned_suggestions = [
            text.strip()
            for text in suggestions
            if isinstance(text, str) and text.strip()
        ]
        if not (1 <= len(cleaned_suggestions) <= 2):
            continue

        seen_ids.add(advisor_id)
        validated_results.append(
            AdvisorResult(
                advisor_id=advisor_id,
                advisor_name=advisor_name_map[advisor_id],
                suggestions=cleaned_suggestions,
            )
        )

    if not validated_results:
        return None

    return AdvisorResponse(
        conversation_id="",
        analysis=analysis.strip(),
        results=validated_results,
    )
