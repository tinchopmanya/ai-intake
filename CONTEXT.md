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

Frontend: Next.js  
Backend: FastAPI  
IA: Google Gemini  
Dev runner: concurrently via npm run dev  
Control: Git + GitHub  
Entorno: Windows + PowerShell + VS Code

---

## 4. Arquitectura del backend

api/
config/
routers/
schemas/
services/
providers/
repositories/
main.py

Endpoints activos:

GET /health  
POST /v1/chat  
GET /v1/chat/{conversation_id}/history  
POST /v1/advisor

---

## 5. Arquitectura del frontend

/chat → chat web  
/advisor → comité de consejeros

- conversation_id persistido en localStorage
- historial cargado desde backend
- advisor usa sesión explícita
- cards visuales por consejero con imagen

---

## 6. Estado funcional actual

Chat web básico — funcional  
Gemini integrado — funcional  
Advisor con análisis — funcional  
Comité de hasta 3 consejeros — funcional  
Una sola llamada Gemini — funcional  
Consejeros con personalidad — funcional  
Skills implementadas — funcional  
Imágenes de consejeros — funcional  
UI con cards — funcional

Pendiente:
- Contact resolution
- Groups and contacts
- Persistencia DB real
- Session list UI
- History-aware advisor context

---

## 7. Decisiones arquitectónicas

- Núcleo compartido entre productos
- /chat y /advisor comparten backend
- IA encapsulada en providers
- Modelo Gemini configurable por .env
- Código en inglés / UI en español
- Una sola llamada a Gemini por sesión
- JSON estructurado analysis + results

---

## 8. Modelo de datos futuro

users  
groups  
contacts  
advisors  
skills  
advisor_skills  
contact_advisors  
group_advisors  
user_advisors  
conversations  
messages  
advisor_outputs

Máximo 3 consejeros por sesión.

---

## 9. Consejeros del sistema

laura — psicóloga  
robert — abogado  
lidia — coach

Cada uno con:
id  
name  
role  
description  
system_prompt_base  
image_url  
skills

---

## 10. Skills

skill:
id  
name  
type (trait | knowledge)  
category  
prompt_snippet  
is_system

prompt_snippet se inyecta en el prompt de Gemini.

Nunca visible al usuario.

---

## 11. Resolución de consejeros

Orden:

1 contacto
2 grupo
3 defaults usuario

Máximo 3.

Sin duplicados.

---

## 12. Llamada a Gemini

Una sola llamada.

Gemini devuelve:

analysis  
results[]

Ejemplo:

{
analysis:"",
results:[
{
advisor_id:"",
advisor_name:"",
suggestions:[]
}
]
}

---

## 13. Imágenes de consejeros

Consejeros del sistema → imagen fija.

Consejeros personalizados → imagen generada con IA.

---

## 14. Variables de entorno

GEMINI_API_KEY
GEMINI_MODEL
GEMINI_TIMEOUT_SECONDS

---

## 15. Roadmap

Alta prioridad

advisor-contact-resolution  
advisor-history-aware-context  
persistence-foundation-db  
groups-and-contacts

Media

advisor-session-list-ui  
advisor-image-generation  
UI improvements  
chat sidebar

Posterior

business product  
whatsapp  
multi-tenant