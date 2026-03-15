# ZeroContact Emocional

Aplicacion web fullstack para asistir respuestas en conversaciones sensibles.

## Stack
- Backend: FastAPI + Pydantic v2
- Frontend: Next.js App Router + React + TypeScript
- Persistencia: PostgreSQL (fallback en memoria solo en local/dev si se habilita)
- Auth: Google Sign-In + opaque session tokens (no JWT en esta version)
- OCR: Google Vision / Tesseract (segun `OCR_PROVIDER`)
- IA: Gemini API (con fallback cuando no hay `GEMINI_API_KEY`)

## Endpoints activos
- `GET /health`
- `POST /v1/auth/google`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET /v1/onboarding/profile`
- `PUT /v1/onboarding/profile`
- `POST /v1/cases`
- `GET /v1/cases`
- `GET /v1/cases/{case_id}`
- `PATCH /v1/cases/{case_id}`
- `POST /v1/incidents`
- `GET /v1/incidents`
- `GET /v1/incidents/{incident_id}`
- `PATCH /v1/incidents/{incident_id}`
- `POST /v1/analysis`
- `GET /v1/analysis/{analysis_id}`
- `POST /v1/advisor`
- `POST /v1/events` (`reply_copied`)
- `GET /v1/ocr/capabilities`
- `POST /v1/ocr/extract`

Compatibilidad legacy (deprecado):
- `POST /v1/chat`
- `GET /v1/conversations/{conversation_id}`

## Requisitos
- Python 3.11+
- Node.js 20+
- npm 10+

## Instalacion
```bash
git clone <tu-repo>
cd ai-intake
cd web && npm install && cd ..
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Variables de entorno
Backend (`api/.env`):
```env
APP_ENV=development
ALLOW_INMEMORY_FALLBACK=true
ENABLE_LEGACY_CHAT_ROUTES=true
CORS_ORIGINS=http://localhost:3000
DATABASE_URL=
GOOGLE_CLIENT_ID=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
GEMINI_TIMEOUT_SECONDS=20
OCR_PROVIDER=auto
OCR_MAX_FILE_BYTES=8388608
OCR_TESSERACT_CMD=
OCR_TESSERACT_LANG=spa+por+eng
OCR_TESSERACT_PSM=6
OCR_TESSERACT_OEM=3
OCR_WHATSAPP_CROP_ENABLED=true
OCR_WHATSAPP_CROP_TOP_PX=80
OCR_WHATSAPP_CROP_BOTTOM_PX=120
OCR_WA_TOP_CROP_RATIO=0.15
OCR_WA_BOTTOM_CROP_RATIO=0.17
OCR_TURN_DETECTION_ENABLED=true
```

Frontend (`web/.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

## Reglas de startup (hardening MVP)
- En `APP_ENV=production|prod`:
  - `DATABASE_URL` obligatorio.
  - `GOOGLE_CLIENT_ID` obligatorio.
  - Si `OCR_PROVIDER` es explicito (`google_vision` o `tesseract`) y no esta disponible, el backend falla al boot.
- En `APP_ENV=development|dev|local|test`:
  - Se permite fallback a memoria solo si `ALLOW_INMEMORY_FALLBACK=true`.
  - El fallback se registra con warnings explicitos.

## Instrumentacion MVP (persistencia producto)
- Analisis persistidos en `analysis_results`.
- Sesiones de wizard persistidas en `advisor_sessions` con input/origen/analysis y respuesta agregada.
- Case Memory minima en `cases` (title/contact/summary/last_activity_at).
- Incident Log minimo en `incidents` (evento, fecha, confirmacion y enlaces opcionales a analysis/session).
- Eventos de adopcion:
  - `reply_generated` (backend)
  - `reply_copied` (frontend -> `POST /v1/events`)

## Ejecutar
Opcion raiz:
```bash
npm install
npm run dev
```

Opcion separada:
```bash
cd api
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

```bash
cd web
npm run dev
```

## Tests
```bash
cd api
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

## MVP Validation Metrics
- Endpoint interno: `GET /v1/metrics/mvp` (requiere sesion autenticada).
- Script de reporte:
```bash
.\api\.venv\Scripts\python.exe .\scripts\mvp_metrics_report.py
```

Variables opcionales del script:
- `METRICS_BASE_URL` (default `http://localhost:8000`)
- `METRICS_ACCESS_TOKEN` (si ya tienes token)
- `METRICS_GOOGLE_ID_TOKEN` (fallback para login automatico)
- `METRICS_TIMEOUT_SECONDS` (default `20`)

### Checklist diario (validacion)
- Revisar `users_logged_in` y `users_completed_onboarding` para confirmar activacion.
- Revisar `wizard_sessions_created` para verificar uso real del flujo principal.
- Revisar `replies_generated` vs `replies_copied` para adoption.
- Revisar `cases_created` e `incidents_created` para continuidad de caso.
- Revisar `case_exports` para señales de valor percibido.
- Revisar `returning_users_7d` para retencion temprana.

### Interpretacion rapida
- `reply_adoption_rate = replies_copied / replies_generated`.
- Si adoption rate es `< 0.15`: revisar calidad de respuestas o friccion de copy.
- Si adoption rate esta entre `0.15` y `0.35`: señal intermedia, seguir iterando prompts/UX.
- Si adoption rate es `> 0.35`: buena señal de utilidad para MVP temprano.
- Si `returning_users_7d` no crece durante la validacion, priorizar mejoras de retencion antes de nuevas features.

## Documentacion API
Detalle en [`docs/API_GUIDE.md`](docs/API_GUIDE.md).
