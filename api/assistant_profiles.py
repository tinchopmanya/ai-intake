DEFAULT_ASSISTANT_PROFILE = "general"

ASSISTANT_PROFILE_INSTRUCTIONS: dict[str, str] = {
    "general": "Responde de forma clara, util y breve.",
    "business_chat": (
        "Responde como asistente para atencion a clientes de una empresa."
        " Prioriza claridad, cortesia y acciones concretas."
    ),
    "emotional_advisor": (
        "Responde como consejero emocional."
        " Prioriza empatia, validacion emocional y sugerencias cuidadosas."
    ),
}


def normalize_assistant_profile(raw_value: str | None) -> str:
    if not raw_value:
        return DEFAULT_ASSISTANT_PROFILE
    value = raw_value.strip()
    if not value:
        return DEFAULT_ASSISTANT_PROFILE
    if value in ASSISTANT_PROFILE_INSTRUCTIONS:
        return value
    return DEFAULT_ASSISTANT_PROFILE


def build_profile_prompt(message: str, assistant_profile: str) -> str:
    normalized_profile = normalize_assistant_profile(assistant_profile)
    instructions = ASSISTANT_PROFILE_INSTRUCTIONS[normalized_profile]
    return (
        f"Perfil del asistente: {normalized_profile}\n"
        f"Instrucciones: {instructions}\n\n"
        f"Mensaje del usuario:\n{message}"
    )
