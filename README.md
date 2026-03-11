# ZeroContact Emocional

Aplicacion web fullstack para ayudar a personas a responder mensajes complejos con mas asertividad y menor escalada emocional.

El flujo principal combina:
- Analisis emocional del mensaje (`/v1/analysis`)
- Generacion de respuestas sugeridas por advisors (`/v1/advisor`)
- Integracion con Gemini como motor de texto

## Stack
- Backend: Python 3.11+, FastAPI, Pydantic v2
- Frontend: Next.js App Router + TypeScript + Tailwind CSS
- IA: Gemini API
- Persistencia: PostgreSQL (con opcion de ejecucion en memoria para desarrollo)
- Auth: Google OAuth (stub de MVP en `POST /v1/auth/google`)
- i18n: base de catalogos `es/en/pt`
- OCR: punto de extension documentado para screenshots (no expuesto aun como endpoint en esta rama)

## Requisitos Previos
- Python 3.11+
- Node.js 20+
- npm 10+
- (Opcional) PostgreSQL/Supabase para persistencia de advisor sessions
- (Opcional) API key de Gemini

## Instalacion Paso a Paso

### 1) Clonar e instalar dependencias de frontend
```bash
git clone <tu-repo>
cd ai-intake
cd web
npm install
cd ..
```

### 2) Crear entorno virtual de backend
```bash
cd api
python -m venv .venv
```

Windows (PowerShell):
```powershell
.\.venv\Scripts\Activate.ps1
```

macOS/Linux:
```bash
source .venv/bin/activate
```

### 3) Instalar dependencias de backend
```bash
pip install fastapi uvicorn python-dotenv pydantic psycopg google-generativeai httpx pytest
```

### 4) Variables de entorno
Backend (`api/.env`):
```env
CORS_ORIGINS=http://localhost:3000
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
GEMINI_TIMEOUT_SECONDS=20
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OCR_PROVIDER=google_vision
GOOGLE_CLOUD_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=
```

Frontend (`web/.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Notas:
- `DATABASE_URL` es requerida solo para persistencia PostgreSQL real en la capa `app.repositories`.
- Sin `GEMINI_API_KEY`, el backend puede usar fallback segun proveedor configurado.

## Ejecutar Backend y Frontend

### Opcion A: desde raiz (script combinado)
```bash
npm install
npm run dev
```

### Opcion B: procesos separados
Backend:
```bash
cd api
uvicorn main:app --reload --port 8000
```

Frontend:
```bash
cd web
npm run dev
```

## Ejecutar Tests

Backend (unittest via pytest):
```bash
cd api
pytest -q
```

Backend (stdlib unittest):
```bash
cd api
python -m unittest discover -s tests -p "test_*.py"
```

Frontend lint:
```bash
cd web
npm run lint
```

## Estructura del Proyecto

```txt
ai-intake/
  api/
    app/
      api/routers/         # Routers v1 (auth, analysis, advisor)
      schemas/             # Modelos Pydantic v2
      services/            # Orquestacion y reglas de negocio
      repositories/        # UnitOfWork + repos Postgres
      resources/
        i18n/              # Catalogos backend es/en/pt
        advisors/          # Configuracion de advisors por pais/idioma
    routers/               # Routers legacy (chat/advisor/history)
    services/              # Servicios legacy y compatibilidad
    providers/             # Proveedor Gemini/fallback
    db/migrations/         # SQL de tablas, indices y politicas
    tests/
  web/
    src/app/               # Rutas Next.js App Router
    src/components/        # Componentes UI y flujos MVP
    src/lib/api/           # Cliente HTTP tipado
    src/data/              # Perfiles de advisors
    src/i18n/messages/     # Catalogos frontend es/en/pt
  docs/
    API_GUIDE.md
```

## Guia de API
La guia detallada de endpoints esta en [`docs/API_GUIDE.md`](docs/API_GUIDE.md).

## i18n

### Donde estan los archivos
- Frontend: `web/src/i18n/messages/{es|en|pt}.json`
- Backend: `api/app/resources/i18n/{es|en|pt}.json`

### Como agregar un nuevo idioma
1. Crear `web/src/i18n/messages/<locale>.json`.
2. Crear `api/app/resources/i18n/<locale>.json`.
3. Agregar `<locale>` en el selector de idioma del frontend.
4. Incluir fallback de mensajes en backend para errores API.
5. Agregar pruebas de snapshots/respuestas para el nuevo locale.

## Advisors

### Donde se definen
- Frontend UI: `web/src/data/advisors.ts`
- Backend (catalogo en memoria actual): `api/repositories/in_memory_advisor_catalog.py`
- Configuracion por pais/idioma: `api/app/resources/advisors/*.json`

### Como agregar un nuevo advisor
1. Crear perfil en `web/src/data/advisors.ts` (id, name, role, description, avatars).
2. Registrar advisor en backend (`in_memory_advisor_catalog.py` o repositorio persistente).
3. Definir `system_prompt_base` y skills del advisor.
4. Agregar fallback de respuesta para ese advisor en la capa de servicio.
5. Cubrir con tests de parser/prompt/orquestador.

### Como agregar un nuevo pais
1. Crear archivo `api/app/resources/advisors/<locale>-<PAIS>.json` (ej. `es-UY.json`).
2. Definir advisors habilitados por pais.
3. Resolver seleccion de advisors usando `context.country` o perfil del usuario.
4. Verificar que frontend envie `pais`/`locale` en el payload contextual.

### Estructura del objeto advisor
```json
{
  "id": "laura",
  "name": "Laura",
  "role": "Empatica",
  "tone": "calmado",
  "enabled": true
}
```

## OCR (screenshots)
- Estado actual: no hay endpoint OCR publico en esta rama.
- Integracion recomendada:
  - Endpoint `POST /v1/ocr/extract`
  - Storage temporal de imagen
  - Extraccion de texto (Google Vision o Tesseract)
  - Validacion manual del texto antes de enviar a `/v1/analysis` y `/v1/advisor`

