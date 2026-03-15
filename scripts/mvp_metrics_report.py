import json
import os
import sys
from urllib.error import HTTPError
from urllib.request import Request
from urllib.request import urlopen


BASE_URL = os.getenv("METRICS_BASE_URL", "http://localhost:8000").rstrip("/")
TIMEOUT_SECONDS = int(os.getenv("METRICS_TIMEOUT_SECONDS", "20"))
ACCESS_TOKEN = os.getenv("METRICS_ACCESS_TOKEN", "").strip()
GOOGLE_ID_TOKEN = os.getenv("METRICS_GOOGLE_ID_TOKEN", "").strip()


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
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = Request(url=url, method=method.upper(), headers=headers, data=data)

    try:
        with urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            status = int(resp.status)
            body = resp.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {body}") from exc

    if status != expected_status:
        raise RuntimeError(f"{method} {path} -> expected {expected_status}, got {status}: {body}")
    return json.loads(body) if body else {}


def _get_access_token() -> str:
    if ACCESS_TOKEN:
        return ACCESS_TOKEN
    if not GOOGLE_ID_TOKEN:
        raise RuntimeError("Provide METRICS_ACCESS_TOKEN or METRICS_GOOGLE_ID_TOKEN.")
    login_payload = _request_json(
        "POST",
        "/v1/auth/google",
        payload={"id_token": GOOGLE_ID_TOKEN},
        expected_status=200,
    )
    return str(login_payload["access_token"])


def _pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def main() -> int:
    token = _get_access_token()
    metrics = _request_json("GET", "/v1/metrics/mvp", token=token, expected_status=200)

    print("=== ExReply MVP Metrics ===")
    print(f"users_logged_in           : {metrics['users_logged_in']}")
    print(f"users_completed_onboarding: {metrics['users_completed_onboarding']}")
    print(f"wizard_sessions_created   : {metrics['wizard_sessions_created']}")
    print(f"replies_generated         : {metrics['replies_generated']}")
    print(f"replies_copied            : {metrics['replies_copied']}")
    print(f"reply_adoption_rate       : {_pct(float(metrics['reply_adoption_rate']))}")
    print(f"cases_created             : {metrics['cases_created']}")
    print(f"incidents_created         : {metrics['incidents_created']}")
    print(f"case_exports              : {metrics['case_exports']}")
    print(f"returning_users_7d        : {metrics['returning_users_7d']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"mvp_metrics_report failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
