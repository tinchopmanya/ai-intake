import re


def get_safe_conversation_title(
    *,
    source_text: str,
    case_title: str | None = None,
    analysis_summary: str | None = None,
) -> str:
    combined = "\n".join(
        part.strip()
        for part in (case_title or "", analysis_summary or "", source_text or "")
        if part and part.strip()
    ).lower()

    if not combined:
        return "Sin tema claro"

    if _matches_any(
        combined,
        (
            r"\b(limite|limites|l[ií]mite|l[ií]mites|presion|presi[oó]n|control|amenaz|"
            r"no me escribas|no me llames|dejame en paz|deja de escribirme|falta de respeto)\b",
        ),
    ):
        return "Limites de comunicacion"

    if _matches_any(
        combined,
        (
            r"\b(gasto|gastos|pago|pagos|dinero|plata|transferencia|cuota|"
            r"reintegro|deuda|expensa|expensas)\b",
        ),
    ):
        return "Gastos compartidos"

    if _matches_any(
        combined,
        (
            r"\b(horario|horarios|hora|horas|turno|turnos|agenda|calendario|"
            r"retiro|entrega|buscar|llevar|pasar|visita|visitas|fin de semana)\b",
        ),
    ):
        return "Coordinacion de horarios"

    if _matches_any(
        combined,
        (
            r"\b(hijo|hija|hijos|hijas|familia|familiar|colegio|escuela|"
            r"guarderia|guarder[ií]a|medico|m[eé]dico|doctor|vacuna|custodia|coparent)\b",
        ),
    ):
        return "Tema familiar"

    if _matches_any(
        combined,
        (
            r"\b(logistica|log[ií]stica|documento|documentos|permiso|papeles|"
            r"firma|formulario|viaje|vacaciones|organizar|coordinar)\b",
        ),
    ):
        return "Logistica"

    return "Sin tema claro"


def _matches_any(source: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, source, flags=re.IGNORECASE) for pattern in patterns)
