# Frontend MVP (Next.js)

Base frontend para integrar el wizard del advisor sobre:
- `POST /v1/analysis`
- `POST /v1/advisor`

## Requisitos

- Node.js 20+
- Backend corriendo (por defecto `http://localhost:8000`)

## Configuracion

1. Crear variables locales:

```bash
cp .env.example .env.local
```

2. Ajustar si hace falta:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Ejecutar

```bash
npm install
npm run dev
```

Abrir:
- `http://localhost:3000/` (home)
- `http://localhost:3000/mvp` (base wizard MVP)

## Estructura base agregada

- `src/lib/config.ts`: resuelve `API_URL`.
- `src/lib/api/types.ts`: tipos request/response para analysis/advisor.
- `src/lib/api/client.ts`: cliente HTTP mínimo.
- `src/components/mvp/*`: shell + scaffold de wizard.
- `src/app/mvp/page.tsx`: página base de MVP.

