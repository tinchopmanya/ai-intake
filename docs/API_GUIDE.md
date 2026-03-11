# API Guide - ZeroContact Emocional

Base URL local: `http://localhost:8000`

## Endpoints

| Metodo | Ruta | Parametros | Descripcion |
|---|---|---|---|
| `GET` | `/health` | - | Healthcheck de servicio |
| `POST` | `/v1/auth/google` | body `GoogleAuthRequest` | Login Google (MVP stub) |
| `POST` | `/v1/analysis` | body `AnalysisRequest` | Analisis emocional/riesgo del mensaje |
| `POST` | `/v1/advisor` | body `AdvisorRequest` | Genera respuestas de advisors |
| `POST` | `/v1/chat` | body `ChatRequest` | Chat simple legacy |
| `GET` | `/v1/conversations/{conversation_id}` | path `conversation_id` | Historial de chat legacy |
| `GET` | `/v1/advisor/conversations` | query `user_id`, `contact_id` | Lista sesiones advisor legacy |
| `GET` | `/v1/advisor/conversations/{conversation_id}` | path `conversation_id` | Historial advisor legacy |

---

## 1) GET /health

### Request
```http
GET /health
```

### Response 200
```json
{
  "ok": true
}
```

### Errores
- No definidos a nivel de dominio.

---

## 2) POST /v1/auth/google

### Body
```json
{
  "id_token": "google-id-token"
}
```

### Response 200
```json
{
  "access_token": "dev-<uuid>",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "0f0f4c89-7ff1-4a4f-84da-e3dfecf9586f",
    "email": "user@example.com",
    "name": "Usuario MVP",
    "memory_opt_in": false
  }
}
```

### Errores
- `401 invalid_google_token`: token ausente o muy corto.

---

## 3) POST /v1/analysis

### Body
```json
{
  "message_text": "Necesito que confirmes horarios para esta semana.",
  "mode": "reactive",
  "relationship_type": "pareja",
  "contact_id": null,
  "quick_mode": false,
  "context": {
    "user_id": "1c47d0cb-4f47-4a80-b14c-a16e1f4f0624"
  }
}
```

### Response 200
```json
{
  "analysis_id": "f0b314d8-6e42-4708-b3a4-9f8a0ec067f7",
  "summary": "Se detecta un tono tenso con necesidad de claridad.",
  "risk_flags": [
    {
      "code": "high_emotion",
      "severity": "medium",
      "confidence": 0.82,
      "evidence": ["uso de frases absolutas"]
    }
  ],
  "emotional_context": {
    "tone": "tension",
    "intent_guess": "marcar limites"
  },
  "ui_alerts": [
    {
      "level": "warning",
      "message": "Revisa el tono antes de enviar."
    }
  ],
  "tone_detected": "tension",
  "suggested_emotion_label": "calm",
  "analysis_skipped": false,
  "created_at": "2026-03-11T15:12:41.631552+00:00"
}
```

### Errores
- `422`: validacion de schema (`message_text` vacio, enum invalido).

---

## 4) POST /v1/advisor

### Body
```json
{
  "message_text": "No sigamos discutiendo por aca, confirmemos horario.",
  "mode": "reactive",
  "relationship_type": "pareja",
  "contact_id": null,
  "quick_mode": false,
  "save_session": true,
  "analysis_id": "f0b314d8-6e42-4708-b3a4-9f8a0ec067f7",
  "prompt_version": "advisor_master_v1",
  "context": {
    "user_id": "1c47d0cb-4f47-4a80-b14c-a16e1f4f0624",
    "memory_opt_in": true,
    "user_style": "neutral_claro"
  }
}
```

### Response 200
```json
{
  "session_id": "0607ea16-7ec2-46c7-84dd-1f7f3dc8f0f5",
  "mode": "reactive",
  "quick_mode": false,
  "analysis": {
    "summary": "Se detecta un tono tenso con necesidad de claridad.",
    "risk_flags": ["high_emotion"]
  },
  "responses": [
    {
      "text": "Entiendo la tension. Propongo ordenar el tema por pasos y evitar reproches.",
      "emotion_label": "empathetic"
    },
    {
      "text": "Confirmame horario exacto para resolverlo sin ambiguedad.",
      "emotion_label": "assertive"
    },
    {
      "text": "Confirmemos horario y lugar para mantener foco logistico.",
      "emotion_label": "neutral"
    }
  ],
  "persistence": {
    "save_session": true,
    "zero_retention_applied": false,
    "outputs_persisted": true,
    "memory_persisted": true
  },
  "created_at": "2026-03-11T15:14:09.415847+00:00"
}
```

### Errores
- `403 analysis_id_forbidden`: el `analysis_id` pertenece a otro usuario.
- `404 analysis_id_not_found_or_expired`: `analysis_id` inexistente o vencido.
- `422`: validacion de request.

---

## 5) POST /v1/chat (legacy)

### Body
```json
{
  "conversation_id": null,
  "message": "Hola, que le responderias a este mensaje?",
  "channel": "web"
}
```

### Response 200
```json
{
  "conversation_id": "2f6f2e61-ec48-4ebd-88d4-4efa8f351422",
  "answer": "Respuesta generada por IA."
}
```

### Errores
- `422`: payload invalido.

---

## 6) GET /v1/conversations/{conversation_id} (legacy)

### Request
```http
GET /v1/conversations/2f6f2e61-ec48-4ebd-88d4-4efa8f351422
```

### Response 200
```json
{
  "conversation_id": "2f6f2e61-ec48-4ebd-88d4-4efa8f351422",
  "messages": [
    {
      "role": "user",
      "message": "Hola",
      "channel": "web"
    },
    {
      "role": "assistant",
      "message": "Respuesta",
      "channel": "assistant"
    }
  ]
}
```

### Errores
- `404 Conversation not found`.

---

## 7) GET /v1/advisor/conversations (legacy)

### Query params
- `user_id` (default: `user-main`)
- `contact_id` (opcional)

### Response 200
```json
{
  "conversations": [
    {
      "conversation_id": "0a65f395-3da6-48da-89d7-29ab2fda8b05",
      "contact_id": "contact-123",
      "created_at": "2026-03-11T14:00:00+00:00",
      "updated_at": "2026-03-11T14:10:00+00:00",
      "analysis_preview": "Se detecta friccion moderada",
      "advisors_count": 3
    }
  ]
}
```

### Errores
- `422`: query param invalido.

---

## 8) GET /v1/advisor/conversations/{conversation_id} (legacy)

### Response 200
```json
{
  "conversation_id": "0a65f395-3da6-48da-89d7-29ab2fda8b05",
  "messages": [
    {
      "role": "user",
      "message": "texto",
      "channel": "advisor"
    }
  ],
  "analysis": "Resumen",
  "results": [
    {
      "advisor_id": "laura",
      "advisor_name": "Laura",
      "suggestions": ["Reflexion: ...", "Respuesta sugerida: ..."]
    }
  ]
}
```

### Errores
- `404 Advisor conversation not found`.

