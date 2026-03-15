const UI_ERROR_MESSAGES: Record<string, string> = {
  analysis_persistence_failed: "No se pudo guardar el analisis. Intenta nuevamente.",
  advisor_generation_failed: "No se pudieron generar respuestas en este momento.",
  incident_creation_failed: "No se pudo registrar el incidente. Intenta nuevamente.",
  database_unavailable: "La base de datos no esta disponible temporalmente.",
  auth_internal_error: "Hubo un error interno de autenticacion.",
  case_memory_unavailable: "La memoria de casos no esta disponible ahora.",
  incident_log_unavailable: "El registro de incidentes no esta disponible ahora.",
  case_export_unavailable: "La exportacion de caso no esta disponible ahora.",
  timeline_unavailable: "La linea de tiempo no esta disponible ahora.",
  patterns_unavailable: "No se pudieron analizar patrones en este momento.",
  validation_error: "Hay datos invalidos. Revisa los campos e intenta nuevamente.",
};

function normalizeCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function toUiErrorMessage(error: unknown, fallback: string): string {
  const direct = normalizeCode(error instanceof Error ? error.message : "");
  if (direct && UI_ERROR_MESSAGES[direct]) {
    return UI_ERROR_MESSAGES[direct];
  }
  if (direct && direct.startsWith("http_")) {
    return fallback;
  }

  const asString = normalizeCode(String(error ?? ""));
  if (asString && UI_ERROR_MESSAGES[asString]) {
    return UI_ERROR_MESSAGES[asString];
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
