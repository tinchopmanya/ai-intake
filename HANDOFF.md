# HANDOFF.md — ai-intake

Versión corta para iniciar sesiones con cualquier IA.

---

## Qué es esto

Plataforma full stack:

Next.js + FastAPI + Gemini

Dos productos sobre el mismo núcleo:

Business Chat  
Advisor Emocional (foco actual)

---

## Idea central

El Advisor ayuda a pensar respuestas para conversaciones difíciles.

No reemplaza psicólogos ni abogados.

Safety-first design.

---

## Stack

Next.js  
FastAPI  
Google Gemini  
Git  
Windows / PowerShell

---

## Rutas activas

/chat

/advisor

POST /v1/chat

GET /v1/chat/{id}/history

POST /v1/advisor

GET /v1/advisor/conversations/{id}

---

## Flujo del Advisor

usuario pega chat

sanitize_input()

detect_risk_flags()

resolve_advisors()

build_prompt()

una llamada Gemini

parse JSON

persistir solo si save_session = true

---

## Modelo central

users  
groups  
contacts

↓

advisor resolution

1 contacto  
2 grupo  
3 defaults usuario

advisors  
skills

---

## Consejeros del sistema

laura → perspectiva empática  
robert → perspectiva estratégica  
lidia → perspectiva directa

Cada uno genera sugerencias.

---

## Contrato API

POST /v1/advisor

Request

conversation_text  
context  
user_id  
contact_id  
conversation_id  
save_session

Response

conversation_id  
analysis  
risk_flags  
results[]

---

## Safety rules

save_session false por defecto

chat no se guarda salvo opt-in

sanitización de PII

risk flags → safety injection

lenguaje probabilístico

no afirmaciones legales categóricas

---

## Fase actual

feature/advisor-safety-foundation

incluye

sanitization_service  
risk_detection_service  
safety injection  
roles visibles en UI

---

## Próximas fases

persistence-foundation-db

advisor-context-memory

groups-and-contacts

advisor-session-list-ui

business product

whatsapp

multi-tenant

---

## Reglas clave

código en inglés

UI en español

una rama por fase

no romper /chat

system_prompt nunca al frontend

una llamada Gemini por sesión