import { retryWaitSuffix } from "./pilot-api.ts";

// Client-side failures (decode, size, session) and server/provider responses
// share one catalogue so no unknown response is mislabeled as a network error.
export const classifyErrorMessages: Record<string, string> = {
  ai_rate_limited:
    "El proveedor de IA está limitando las solicitudes en este momento.",
  ai_quota_minute:
    "Hiciste varios análisis seguidos. Espera un momento antes de reintentar.",
  ai_quota_daily:
    "Alcanzaste tu límite diario de análisis con IA. El cupo se renueva a las 00:00 UTC.",
  ai_quota_global:
    "Se agotó el cupo diario de IA de la plataforma. El cupo se renueva a las 00:00 UTC.",
  ai_quota_busy:
    "El análisis con IA está ocupado en este momento. Reintenta en unos segundos.",
  ai_provider_unavailable:
    "El proveedor de IA no respondió. Puedes clasificar el residuo manualmente.",
  ai_quota_store_unavailable:
    "El control de cuota de IA no está disponible. Para proteger tu cuenta, analiza manualmente por ahora.",
  ai_provider_unconfigured:
    "El análisis con IA todavía no está configurado. La clasificación manual sigue disponible.",
  ai_provider_auth_failed:
    "El proveedor rechazó la autenticación del servidor. La clasificación manual sigue disponible.",
  ai_provider_model_unavailable:
    "El modelo de análisis no está disponible. Reintenta más tarde o clasifica manualmente.",
  ai_provider_model_not_allowed:
    "El modelo de IA configurado no está permitido en el servidor. La clasificación manual sigue disponible.",
  ai_provider_model_not_verified:
    "El modelo de IA configurado no está verificado. La clasificación manual sigue disponible.",
  ai_provider_no_verified_free_open_model:
    "No hay un modelo gratuito verificado disponible. La clasificación manual sigue disponible.",
  ai_provider_invalid:
    "La configuración del proveedor de IA no es válida en el servidor. La clasificación manual sigue disponible.",
  ai_provider_rejected_request:
    "El proveedor no pudo aceptar esta imagen. Prueba con otra foto o clasifica manualmente.",
  ai_consent_required:
    "Debes autorizar el envío de la imagen al proveedor antes de analizarla.",
  authentication_required:
    "Tu sesión expiró. Inicia sesión de nuevo para analizar imágenes.",
  invalid_ai_category:
    "El proveedor devolvió una categoría no válida. Intenta con otra foto o clasifica manualmente.",
  invalid_ai_response:
    "El proveedor devolvió una respuesta no válida. Intenta con otra foto o clasifica manualmente.",
  invalid_image:
    "No se pudo procesar la imagen. Elige un JPG o PNG válido de hasta 5 MB.",
  image_too_large:
    "La imagen procesada supera el límite de 5 MB. Usa una foto más pequeña o clasifica manualmente.",
  png_required:
    "El servidor solo acepta imágenes PNG procesadas. Vuelve a intentarlo desde el panel.",
  missing_session_token:
    "Tu sesión expiró. Inicia sesión de nuevo para analizar imágenes.",
  request_rejected:
    "El servidor rechazó la solicitud. Revisa la imagen o clasifica manualmente.",
  server_error:
    "El servidor no pudo completar el análisis. Reintenta o clasifica manualmente.",
  network:
    "No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.",
};

// The server may send the remaining wait for a quota window or a provider rate
// limit. Unknown 4xx responses are rejections and 5xx responses are server
// failures, not network failures.
export function classifyMessage(
  code: string,
  retryAfterSeconds: number,
  status = 0,
): string {
  const fallback =
    status >= 500
      ? classifyErrorMessages.server_error!
      : status >= 400
        ? classifyErrorMessages.request_rejected!
        : classifyErrorMessages.network!;
  const base = classifyErrorMessages[code] ?? fallback;
  return `${base}${retryWaitSuffix(retryAfterSeconds)}`;
}

export class ClassifyError extends Error {
  readonly code: string;
  readonly retryAfterSeconds: number;
  readonly status: number;
  constructor(
    code: string,
    retryAfterSeconds: number,
    status = 0,
    message?: string,
  ) {
    super(message ?? code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}
