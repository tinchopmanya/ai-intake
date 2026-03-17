# API Guide - ZeroContact Emocional

Base URL local: `http://localhost:8000`

## Runtime Surface

| Metodo | Ruta | Estado | Notas |
|---|---|---|---|
| `GET` | `/health` | Activo | Healthcheck |
| `POST` | `/v1/auth/google` | Activo | Login Google + creacion de sesion opaca |
| `POST` | `/v1/auth/refresh` | Activo | Rotacion de access/refresh token opacos |
| `POST` | `/v1/auth/logout` | Activo | Revocacion por refresh token |
| `GET` | `/v1/auth/me` | Activo | Usuario actual por bearer token |
| `GET` | `/v1/onboarding/profile` | Activo | Perfil onboarding |
| `PUT` | `/v1/onboarding/profile` | Activo | Persistencia onboarding |
| `POST` | `/v1/cases` | Activo | Crear caso minimo |
| `GET` | `/v1/cases` | Activo | Listar casos del usuario |
| `GET` | `/v1/cases/{case_id}` | Activo | Obtener caso |
| `PATCH` | `/v1/cases/{case_id}` | Activo | Editar metadata/resumen del caso |
| `POST` | `/v1/incidents` | Activo | Registrar evento/incidente |
| `GET` | `/v1/incidents` | Activo | Listar incidentes (filtrable por `case_id`) |
| `GET` | `/v1/incidents/{incident_id}` | Activo | Obtener incidente |
| `PATCH` | `/v1/incidents/{incident_id}` | Activo | Editar o confirmar incidente |
| `POST` | `/v1/analysis` | Activo | Analisis emocional/riesgo |
| `GET` | `/v1/analysis/{analysis_id}` | Activo | Lectura de analisis persistido por usuario |
| `POST` | `/v1/advisor` | Activo | Respuestas de advisors |
| `POST` | `/v1/advisor/chat` | Activo | Conversacion con advisor (separada de rewrite) |
| `POST` | `/v1/events` | Activo | Tracking MVP (`reply_copied`) |
| `GET` | `/v1/ocr/capabilities` | Activo | Probe de disponibilidad OCR |
| `POST` | `/v1/ocr/extract` | Activo | OCR de imagen autenticado |
| `POST` | `/v1/chat` | Legacy | Compatibilidad, deprecado |
| `GET` | `/v1/conversations/{conversation_id}` | Legacy | Compatibilidad, deprecado |

## Estrategia de auth actual (MVP)

- Esta version usa **opaque session tokens** (no JWT):
  - `access_token` opaco de vida corta.
  - `refresh_token` opaco de vida larga.
  - ambos se guardan hasheados en `auth_sessions` (PostgreSQL) o memoria local dev.
- El cliente web persiste sesion en `localStorage` (`zc_auth_session_v1`).
- El backend autentica por `Authorization: Bearer <access_token>`.

## Errores frecuentes de auth

- `missing_bearer_token` -> `401`
- `invalid_or_expired_session` -> `401`
- `invalid_refresh_token` -> `401`
- `google_client_id_not_configured` -> `400`
- `invalid_google_token` -> `401`
- `database_unavailable` -> `503`

## OCR

- `GET /v1/ocr/capabilities` devuelve disponibilidad real del entorno.
- `POST /v1/ocr/extract` requiere sesion valida.
- El proveedor se controla con `OCR_PROVIDER`:
  - `auto`
  - `google_vision`
  - `tesseract`

## Persistencia MVP de uso real

- `POST /v1/analysis` ahora persiste en `analysis_results` (cuando hay DB activa) y devuelve `analysis_id`.
- `POST /v1/advisor` persiste sesion base en `advisor_sessions`:
  - `source_type`, `original_input_text`, `analysis_id`, `advisor_response_json`.
- `POST /v1/advisor/chat` usa contrato conversacional:
  - `messages[]` con historial.
  - `entry_mode` (`advisor_conversation` o `advisor_refine_response`).
  - `suggested_reply` solo cuando aplica (normalmente refine).
- `case_id` puede viajar en `analysis/advisor` y se valida ownership.
- Al usar `case_id`, el backend actualiza `cases.last_activity_at` y agrega una linea al `summary` acumulado.
- `POST /v1/incidents` permite registrar hechos relevantes:
  - tipos cortos (`schedule_change`, `cancellation`, `payment_issue`, `hostile_message`, `documentation`, `other`).
  - `source_type` (`manual`, `wizard`, `vent`, `ocr`).
  - enlaces opcionales a `analysis_id` y `session_id`.
- El backend emite `reply_generated` en `analytics.wizard_events` por cada respuesta.
- El frontend emite `reply_copied` con `POST /v1/events`.
- `advisor_sessions.selected_advisor_id` se actualiza con el advisor copiado.

Con esto se puede medir `reply adoption rate = reply_copied / reply_generated`.

## Hardening de startup

- En `APP_ENV=production|prod`, el backend valida al boot:
  - `DATABASE_URL` presente.
  - `GOOGLE_CLIENT_ID` presente.
  - Si `OCR_PROVIDER` es explicito (`google_vision` o `tesseract`), que ese provider sea utilizable.
- Si falla alguna validacion critica, el proceso **no arranca**.
- En local/dev, el fallback en memoria solo se permite con `ALLOW_INMEMORY_FALLBACK=true` y queda logueado.

## Nota sobre endpoints legacy

- Los endpoints `/v1/chat` y `/v1/conversations/*` se mantienen por compatibilidad.
- Se puede deshabilitar su montaje con `ENABLE_LEGACY_CHAT_ROUTES=false`.
- Si estan activos, responden header `X-API-Lifecycle: legacy`.
