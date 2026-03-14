# Legacy Router Scope

This package now contains only compatibility endpoints that are still used by the web app:

- `health.py`
- `chat.py`

`chat.py` is a legacy compatibility surface and can be disabled with:
- `ENABLE_LEGACY_CHAT_ROUTES=false`

Advisor, auth, analysis, and OCR routes live in `api/app/api/routers/` and are the canonical v1 API surface.
