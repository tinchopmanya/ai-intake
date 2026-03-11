"""
Legacy advisor service intentionally disabled.

Use `app.api.routers.advisor` + `app.services.advisor_orchestrator` as the only
active advisor flow.
"""


class AdvisorService:
    def __init__(self, *args, **kwargs) -> None:
        raise RuntimeError(
            "Legacy AdvisorService is disabled. Use /v1/advisor from app/api/routers."
        )
