# CONTEXT.md — ai-intake

> Fuente de verdad del proyecto. Actualizar al cerrar cada fase.
> Última actualización: 2026-03-08

---

## 1. Visión del proyecto

`ai-intake` es una plataforma full stack con IA diseñada como **núcleo compartido** para dos productos distintos. No es solo un chat — es una base reutilizable sobre la que se montan experiencias diferentes.

---

## 2. Los dos productos objetivo

### Producto A — Business Chat (tipo Chattigo / WhatsApp para empresas)
- Inbox de conversaciones
- Múltiples canales (web, WhatsApp futuro)
- Bots/asistentes por empresa
- Multi-tenant en el futuro

### Producto B — Advisor Emocional ← foco actual
- El usuario pega una conversación externa
- La IA analiza el contexto y sugiere respuestas
- Consejeros con personalidad, skills e imagen propia
- Hasta 3 consejeros activos por sesión
- 1 o 2 sugerencias por consejero por sesión

---

## 3. Stack actual

| Capa          | Tecnología                          |
|---------------|-------------------------------------|
| Frontend      | Next.js (App Router)                |
| Backend       | FastAPI (Python, entorno `.venv`)   |
| IA            | Google Gemini API                   |
| Dev runner    | `concurrently` via `npm run dev`    |
| Control       | Git + GitHub                        |
| Entorno local | Windows + PowerShell + VS Code      |

---

## 4. Arquitectura del backend

```
api/
  config/        # variables de entorno, settings
  routers/       # endpoints por dominio
  schemas/       # modelos Pydantic
  services/      # lógica de negocio
  providers/     # capa IA (Gemini, desacoplada del SDK)
  repositories/  # acceso a datos (hoy en memoria)
  main.py        # entrada liviana
```

### Endpoints activos
- `GET  /health`
- `POST /v1/chat` — body: `message`, `conversation_id?`, `channel` (default `"web"`)
- `GET  /v1/chat/{conversation_id}/history`

---

## 5. Arquitectura del frontend

```
/chat     → chat web con historial y nueva conversación
/advisor  → consejero emocional (pegar conversación + sugerencia IA)
```

- `conversation_id` persistido en `localStorage`
- Historial cargado desde backend al montar

---

## 6. Estado funcional actual

| Feature                         | Estado         |
|---------------------------------|----------------|
| Chat web básico                 | ✅ Funcional    |
| Historial en memoria            | ✅ Funcional    |
| UUID por conversación           | ✅ Funcional    |
| localStorage conversation_id   | ✅ Funcional    |
| Gemini integrado                | ✅ Funcional    |
| /advisor con análisis IA        | ✅ Funcional    |
| Manejo errores 429 / 404 Gemini | ✅ Implementado |
| Contraste / legibilidad UI      | ⚠️ Mejorable   |
| Sidebar de conversaciones       | ⏳ Pendiente    |
| Consejeros con personalidad     | ⏳ Pendiente    |
| Skills de consejeros            | ⏳ Pendiente    |
| Imágenes de consejeros          | ⏳ Pendiente    |
| Grupos de contactos             | ⏳ Pendiente    |
| Herencia de consejeros          | ⏳ Pendiente    |
| Modos de respuesta del advisor  | ⏳ Pendiente    |
| Persistencia real (DB)          | ⏳ Pendiente    |

---

## 7. Decisiones arquitectónicas tomadas

1. El sistema no es una sola UI: es un **núcleo compartido** con experiencias montadas encima
2. `/chat` y `/advisor` comparten backend, servicios y proveedor IA
3. La IA está encapsulada detrás de una capa `providers` — no hardcodeada
4. El modelo Gemini es **configurable por `.env`**
5. Se descartaron microtickets por rama — se trabaja con **fases por entregable funcional**
6. La lógica no se concentra en `main.py`
7. **Código en inglés, UI e interfaz en español**
8. Una sola llamada a Gemini por sesión devuelve las sugerencias de los 3 consejeros en JSON estructurado — no una llamada por consejero

---

## 8. Modelo de datos futuro

```
users             → usuario principal (ej: Martin)
groups            → grupos de contactos (Familia, Clientes, Amigos...)
contacts          → personas, pertenecen a un grupo
advisors          → consejeros con personalidad, skills e imagen
skills            → rasgos/capacidades reutilizables
advisor_skills    → relación many-to-many consejero ↔ skills
contact_advisors  → consejeros asignados directamente a una persona (máx 3)
group_advisors    → consejeros asignados a un grupo
user_advisors     → consejeros default del usuario (fallback final)
conversations     → conversación con un contacto
messages          → mensajes (sender_type: owner | contact | assistant)
advisor_outputs   → sugerencias generadas por consejero (1 o 2 por sesión)
```

> ⚠️ El sistema debe distinguir claramente al **usuario principal** de los contactos.
> La IA no debe confundirlos.

---

## 9. Modelo de consejeros (detalle)

Cada `advisor` tiene:
- `id` — slug único
- `name` — nombre visible
- `role` — rol visible (Psicóloga, Abogado, Coach...)
- `description` — descripción corta para la UI
- `system_prompt_base` — prompt base interno, nunca expuesto al frontend
- `image_url` — imagen generada con IA al crear el consejero
- `is_system` — si es un consejero predefinido del sistema (no editable)
- `owner_user_id` — null si es del sistema, user_id si es creado por el usuario

### Consejeros del sistema por defecto
| id | Nombre | Rol |
|----|--------|-----|
| `laura` | Laura | Psicóloga |
| `robert` | Robert | Abogado |
| `lidia` | Lidia | Coach y consejera |

---

## 10. Modelo de skills (detalle)

Cada `skill` tiene:
- `id` — slug único
- `name` — etiqueta visible al usuario en español
- `type` — `"trait"` (personalidad) o `"knowledge"` (conocimiento/capacidad)
- `category` — `"tone"` | `"style"` | `"knowledge"` | `"strategy"`
- `prompt_snippet` — fragmento inyectado en el system prompt de Gemini (**nunca visible al usuario**)
- `is_system` — si es una skill predefinida del sistema
- `owner_user_id` — null si es del sistema, user_id si la creó el usuario

### Skills del sistema predefinidas
Ver archivo `SKILLS_LIBRARY.md` para la lista completa con prompt_snippets.

### Cómo se arma el system prompt final
```
{advisor.system_prompt_base}

Rasgos y capacidades adicionales que debés aplicar:
- {skill_1.prompt_snippet}
- {skill_2.prompt_snippet}
- ...
```

---

## 11. Lógica de resolución de consejeros por sesión

Cuando el usuario abre una conversación con una persona, el sistema resuelve automáticamente qué consejeros usar siguiendo esta prioridad:

```
Paso 1 — Consejeros de la persona     (contact_advisors)
Paso 2 — Consejeros del grupo         (group_advisors, sin duplicados)
Paso 3 — Consejeros default del usuario (user_advisors, sin duplicados)
Paso 4 — Cortar a máximo 3
```

**Reglas:**
- Siempre tienen prioridad los consejeros asignados directamente a la persona
- Los del grupo completan si hay slots libres
- Los defaults del usuario son el último fallback
- Sin duplicados — si el mismo consejero aparece en varios niveles, cuenta una sola vez
- Máximo 3 consejeros por sesión

**Ejemplo A:**
```
Juan (Persona) → Robert
Grupo Clientes → Lidia
Defaults usuario → Laura, Lidia

Resultado: Robert (persona) + Lidia (grupo) + Laura (default)
→ 3 consejeros, sin duplicados
```

**Ejemplo B:**
```
Ana (Persona) → Laura, Robert, Lidia
Grupo Familia → Laura

Resultado: Laura + Robert + Lidia (todos de Ana, grupo no suma porque ya hay 3)
→ 3 consejeros
```

**Ejemplo C:**
```
Pedro (Persona) → sin consejeros
Grupo Amigos → sin consejeros
Defaults usuario → Laura

Resultado: Laura (default)
→ 1 consejero activo
```

---

## 12. Llamada a Gemini por sesión (arquitectura)

**Decisión:** una sola llamada a Gemini por sesión de análisis, no una por consejero.

El backend arma un prompt único que instruye a Gemini a responder como los 3 consejeros simultáneamente y devolver JSON estructurado:

```json
{
  "advisors": [
    {
      "advisor_id": "laura",
      "suggestions": ["sugerencia 1", "sugerencia 2"]
    },
    {
      "advisor_id": "robert",
      "suggestions": ["sugerencia 1", "sugerencia 2"]
    },
    {
      "advisor_id": "lidia",
      "suggestions": ["sugerencia 1"]
    }
  ]
}
```

**Ventajas:**
- Una sola llamada = menor latencia, menor costo de API
- El usuario ve las 3 respuestas al mismo tiempo
- Menos puntos de falla

---

## 13. Imágenes de consejeros

- Los consejeros del sistema (Laura, Robert, Lidia) tienen imágenes pregeneradas fijas
- Al crear un consejero personalizado, el usuario describe cómo quiere que se vea
- El backend llama a una API de generación de imágenes y guarda la URL resultante
- La imagen se muestra en el selector de consejero y junto a cada sugerencia en la UI
- API sugerida: DALL-E (OpenAI) o Stable Diffusion (gratuito con límites)

---

## 14. Variables de entorno requeridas (backend)

```env
GEMINI_API_KEY=
GEMINI_MODEL=            # usar el modelo verificado en tu proyecto
GEMINI_TIMEOUT_SECONDS=30
```

Plantilla pública en `api/.env.example`. Nunca commitear `.env`.

---

## 15. Roadmap próximo

### 🔴 Prioridad alta
1. **advisor-profiles** — consejeros por defecto, prompt base, imagen fija, tonos en español ← en curso
2. **advisor-skills** — skills predefinidas, asignación a consejeros, CRUD de skills de usuario
3. **advisor-response-modes** — una llamada Gemini, JSON estructurado, 1-2 sugerencias por consejero
4. **persistence-foundation** — DB real: users, groups, contacts, advisors, skills, conversations, messages, outputs

### 🟡 Prioridad media
5. **groups-and-contacts** — CRUD de grupos, contactos, asignación de consejeros, herencia
6. **advisor-image-generation** — generación de imagen al crear consejero personalizado
7. Mejoras visuales: contraste, botones copiar/regenerar
8. Sidebar de conversaciones para /chat

### 🟢 Prioridad posterior
9. Producto empresa / inbox
10. Canal WhatsApp
11. Multi-tenant / autenticación

---

## 16. Convenciones de trabajo

- Una rama por **fase/entregable funcional**, no por microcambio
- Commits al cerrar una fase, no por cada línea
- No romper `/chat` al evolucionar `/advisor`
- No sobreingeniería — soluciones simples primero
- Actualizar este archivo al cerrar cada fase

---

## 17. Modelo de producto Business (CRM conversacional liviano)

El producto Business comparte el núcleo con el Advisor pero se especializa en:
- ficha rica del contacto
- historial de interacciones
- resumen operativo
- exportación con timestamps
- trazabilidad por fecha y hora

Casos de uso objetivo: restaurantes, prestadores de salud, atención al cliente en general.

### Tabla: contacts (compartida con Advisor, extendida para Business)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | |
| `owner_user_id` | FK | usuario dueño del contacto |
| `group_id` | FK nullable | grupo al que pertenece |
| `first_name` | string | |
| `last_name` | string | |
| `phone` | string nullable | |
| `email` | string nullable | |
| `document_type` | string nullable | cédula, DNI, pasaporte, RUT, etc. |
| `document_number` | string nullable | |
| `profile_summary` | string nullable | resumen histórico, máx 1000 chars |
| `created_at` | datetime | |
| `updated_at` | datetime | |

> `document_type` + `document_number` en lugar de columna fija `cedula` — sirve para cualquier país y tipo de documento.
> `profile_summary` puede generarse/actualizarse manualmente o con IA en el futuro.

### Tabla: interactions

Registra cada contacto con una persona, independientemente del canal.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID | |
| `contact_id` | FK | |
| `conversation_id` | FK nullable | si aplica |
| `channel` | enum | `web`, `whatsapp`, `phone`, `email`, `in_person` |
| `direction` | enum | `inbound`, `outbound`, `internal_note` |
| `content` | text | contenido del mensaje o nota |
| `summary` | string nullable | resumen breve de la interacción |
| `advisor_id` | FK nullable | consejero usado, si aplica |
| `created_by_user_id` | FK | operador que registró |
| `created_at` | datetime | fecha y hora exacta |
| `metadata_json` | json nullable | campos extra por vertical |

### Exportación

Disponible en ambos productos (Advisor y Business).

**Qué se exporta:**
- Contactos: nombre, teléfono, email, documento, resumen, fecha de alta, última actualización
- Interacciones: fecha/hora, canal, dirección, contenido, resumen, operador, consejero
- Conversaciones: fecha inicio, última actualización, contacto, canal, estado

**Formatos:**
- CSV (primera versión)
- Excel (primera versión)
- PDF (futuro)

### Campos extra por vertical (via metadata_json)

**Restaurante:** preferencias, reservas, reclamos, frecuencia, notas de atención
**Salud:** observaciones administrativas, historial de gestiones (sin datos clínicos sensibles en v1)

### Privacidad (a tener en cuenta desde el diseño)

El modelo guarda datos personales sensibles (documento, teléfono, mail, historial).
Desde ahora diseñar sabiendo que existirán:
- permisos de acceso por usuario
- exportación controlada
- borrado / anonimización en el futuro

No hace falta resolverlo en v1, pero no ignorarlo en las decisiones de arquitectura.

### Fase asociada

**`feature/business-contact-foundation`**
- CRUD de contactos con campos extendidos
- Tabla de interacciones
- Exportación CSV/Excel con timestamps
- UI de ficha de contacto
