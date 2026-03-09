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
    if not isinstance(analysis, str):
        return None

    raw_results = data.get("results")
    raw_perspectives = data.get("perspectives")
    if isinstance(raw_results, list):
        validated_results = _parse_results_shape(raw_results, resolved_advisors)
    elif isinstance(raw_perspectives, list):
        validated_results = _parse_perspectives_shape(raw_perspectives, resolved_advisors)
    else:
        return None

    if not validated_results:
        return None

    return AdvisorResponse(
        conversation_id="",
        analysis=analysis.strip(),
        results=validated_results,
    )


def _parse_results_shape(
    raw_results: list[object], resolved_advisors: list[Advisor]
) -> list[AdvisorResult]:
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

    return validated_results


def _parse_perspectives_shape(
    raw_perspectives: list[object], resolved_advisors: list[Advisor]
) -> list[AdvisorResult]:
    advisor_by_name = {advisor.name.strip().lower(): advisor for advisor in resolved_advisors}
    seen_ids: set[str] = set()
    validated_results: list[AdvisorResult] = []

    for item in raw_perspectives:
        if not isinstance(item, dict):
            continue

        advisor_name = item.get("advisor")
        reflection = item.get("reflection")
        suggested_reply = item.get("suggested_reply")

        if not isinstance(advisor_name, str):
            continue
        advisor = advisor_by_name.get(advisor_name.strip().lower())
        if advisor is None or advisor.id in seen_ids:
            continue
        if not isinstance(suggested_reply, str) or not suggested_reply.strip():
            continue

        suggestions: list[str] = [suggested_reply.strip()]
        if isinstance(reflection, str) and reflection.strip():
            suggestions.append(f"Reflexion: {reflection.strip()}")
        suggestions = suggestions[:2]
        if not suggestions:
            continue

        seen_ids.add(advisor.id)
        validated_results.append(
            AdvisorResult(
                advisor_id=advisor.id,
                advisor_name=advisor.name,
                suggestions=suggestions,
            )
        )

    return validated_results
