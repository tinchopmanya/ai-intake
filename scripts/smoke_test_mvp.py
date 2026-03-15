import json
import os
import sys
from datetime import UTC
from datetime import datetime
from urllib.error import HTTPError
from urllib.request import Request
from urllib.request import urlopen


BASE_URL = os.getenv("SMOKE_BASE_URL", "http://localhost:8000").rstrip("/")
GOOGLE_ID_TOKEN = os.getenv("SMOKE_GOOGLE_ID_TOKEN", "").strip()
TIMEOUT_SECONDS = int(os.getenv("SMOKE_TIMEOUT_SECONDS", "20"))


def _request_json(
    method: str,
    path: str,
    *,
    token: str | None = None,
    payload: dict | None = None,
    expected_status: int = 200,
) -> dict:
    url = f"{BASE_URL}{path}"
    data = None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = Request(url=url, method=method.upper(), data=data, headers=headers)
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = int(response.status)
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {body}") from exc

    if status != expected_status:
        raise RuntimeError(f"{method} {path} -> expected {expected_status}, got {status}: {body}")
    return json.loads(body) if body else {}


def _request_text(
    method: str,
    path: str,
    *,
    token: str | None = None,
    expected_status: int = 200,
) -> str:
    url = f"{BASE_URL}{path}"
    headers = {"Accept": "text/markdown"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url=url, method=method.upper(), headers=headers)
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = int(response.status)
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {body}") from exc
    if status != expected_status:
        raise RuntimeError(f"{method} {path} -> expected {expected_status}, got {status}: {body}")
    return body


def main() -> int:
    if not GOOGLE_ID_TOKEN:
        print("SMOKE_GOOGLE_ID_TOKEN is required for login step.", file=sys.stderr)
        return 2

    print(f"[1/8] login -> {BASE_URL}/v1/auth/google")
    login = _request_json(
        "POST",
        "/v1/auth/google",
        payload={"id_token": GOOGLE_ID_TOKEN},
        expected_status=200,
    )
    access_token = str(login["access_token"])

    print("[2/8] create_case")
    created_case = _request_json(
        "POST",
        "/v1/cases",
        token=access_token,
        payload={
            "title": f"Smoke Case {datetime.now(UTC).isoformat()}",
            "contact_name": "Contacto Smoke",
            "relationship_type": "otro",
        },
        expected_status=201,
    )
    case_id = str(created_case["id"])

    print("[3/8] analysis")
    analysis = _request_json(
        "POST",
        "/v1/analysis",
        token=access_token,
        payload={
            "message_text": "Necesito coordinar un cambio de horario.",
            "mode": "reactive",
            "relationship_type": "otro",
            "case_id": case_id,
            "source_type": "text",
            "quick_mode": False,
        },
        expected_status=200,
    )
    analysis_id = str(analysis["analysis_id"])

    print("[4/8] advisor")
    advisor = _request_json(
        "POST",
        "/v1/advisor",
        token=access_token,
        payload={
            "message_text": "Necesito responder sin escalar conflicto.",
            "mode": "reactive",
            "relationship_type": "otro",
            "case_id": case_id,
            "source_type": "text",
            "quick_mode": False,
            "save_session": True,
            "analysis_id": analysis_id,
        },
        expected_status=200,
    )
    session_id = str(advisor["session_id"])

    print("[5/8] copy reply event (simulado)")
    _request_json(
        "POST",
        "/v1/events",
        token=access_token,
        payload={
            "event_name": "reply_copied",
            "session_id": session_id,
            "analysis_id": analysis_id,
            "advisor_id": "laura",
            "response_index": 0,
        },
        expected_status=202,
    )

    print("[6/8] create incident")
    _request_json(
        "POST",
        "/v1/incidents",
        token=access_token,
        payload={
            "case_id": case_id,
            "incident_type": "other",
            "title": "Evento smoke",
            "description": "Registro automatico de prueba.",
            "source_type": "wizard",
            "related_analysis_id": analysis_id,
            "related_session_id": session_id,
            "incident_date": datetime.now(UTC).date().isoformat(),
            "confirmed": False,
        },
        expected_status=201,
    )

    print("[7/8] timeline fetch")
    timeline = _request_json(
        "GET",
        f"/v1/cases/{case_id}/timeline",
        token=access_token,
        expected_status=200,
    )
    if "events" not in timeline:
        raise RuntimeError("timeline response missing events")

    print("[8/8] export")
    export_text = _request_text(
        "GET",
        f"/v1/cases/{case_id}/export",
        token=access_token,
        expected_status=200,
    )
    if f"# Caso: {created_case['title']}" not in export_text:
        raise RuntimeError("export response missing case title")

    print("SMOKE TEST MVP OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
