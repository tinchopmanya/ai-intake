# HANDOFF.md — ai-intake

> Versión corta para iniciar sesiones con cualquier IA. Para detalle completo ver CONTEXT.md.

---

## Qué es esto

Plataforma full stack (Next.js + FastAPI + Gemini) con **núcleo compartido** para dos productos:

- **Business Chat** — inbox conversacional para empresas, canal WhatsApp futuro
- **Advisor Emocional** — el usuario pega una conversación, la IA analiza y genera sugerencias desde múltiples consejeros ← **foco actual**

---

## Stack

Next.js · FastAPI · Google Gemini · Git/GitHub · Windows/PowerShell

---

## Rutas activas

| Ruta | Estado |
|------|--------|
| `/chat` | ✅ Chat web con historial |
| `/advisor` | ✅ Análisis de conversaciones con IA |
| `POST /v1/chat` | ✅ Endpoint principal |
| `GET /v1/chat/{id}/history` | ✅ Historial por conversación |

---

## Modelo central (resumen)

```
users → groups → contacts
                    ↓
            advisor resolution (máx 3 por sesión)
            1. consejeros de la persona
            2. consejeros del grupo
            3. defaults del usuario

advisors → tienen skills asignadas + imagen generada con IA
skills   → trait (tono/estilo) o knowledge (capacidad)

Una sola llamada a Gemini por sesión → JSON con sugerencias de los 3 consejeros
```

---

## Próximas fases

1. **advisor-profiles** — Laura, Robert, Lidia con prompt base, imagen fija y tonos en español ← en curso
2. **advisor-skills** — librería de skills, asignación a consejeros, CRUD de usuario
3. **advisor-response-modes** — una llamada Gemini, JSON estructurado, 1-2 sugerencias por consejero
4. **persistence-foundation** — DB real completa
5. **groups-and-contacts** — grupos, herencia de consejeros, CRUD

---

## Reglas clave

- Código en inglés, UI en español
- Una rama por fase funcional, no por microcambio
- No romper `/chat` al tocar `/advisor`
- El `system_prompt` y `prompt_snippet` de skills **nunca se exponen al frontend**
- Modelo Gemini configurable por `.env` — nunca hardcodeado
- Una sola llamada a Gemini por sesión de análisis (no una por consejero)

---

## Producto Business (CRM conversacional liviano)

Mismo núcleo que Advisor, especializado en:
- Ficha de contacto: nombre, apellido, teléfono, email, documento (tipo+número), resumen histórico (máx 1000 chars)
- Tabla `interactions`: cada contacto con la persona, canal, dirección, timestamp exacto
- Exportación CSV/Excel con fechas y horas
- Casos de uso: restaurantes, salud, atención al cliente

Fase asociada: `feature/business-contact-foundation`
