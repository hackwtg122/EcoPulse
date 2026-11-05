import { GuideApiError, guideQuotaMessages } from "./guide-api.ts";
import { retryWaitSuffix } from "./pilot-api.ts";

// One catalogue for guide and conversation-storage failures. Validation and
// session errors must not suggest an immediate retry that cannot succeed.
export const guideErrorMessages: Record<string, string> = {
  guide_storage_migration_required:
    "El historial no está habilitado todavía en el servidor. Puedes conversar sin guardar.",
  guide_storage_unavailable:
    "No pudimos acceder al historial. No se ha confirmado el guardado; reintenta sin duplicar la pregunta.",
  guide_storage_configuration_required:
    "El historial requiere la conexión de base de datos con permisos limitados. Puedes conversar sin guardar mientras se configura.",
  schema_migration_required:
    "El historial no está habilitado todavía en el servidor. Puedes conversar sin guardar.",
  permissions_unavailable:
    "El historial no tiene permisos suficientes en el servidor. Puedes conversar sin guardar.",
  conversation_not_found:
    "Esta conversación ya no existe o no pertenece a tu cuenta.",
  conversation_limit_reached:
    "Has alcanzado 50 conversaciones. Elimina una propia antes de crear otra.",
  conversation_turn_limit_reached:
    "Esta conversación alcanzó 100 preguntas. Inicia una nueva.",
  guide_conversation_busy:
    "Hay una respuesta pendiente. Espera; si se interrumpió el servidor, podrás reintentar tras cinco minutos.",
  guide_idempotency_conflict:
    "La solicitud anterior tenía otra pregunta. Recarga el historial antes de continuar.",
  guide_turn_changed:
    "La conversación cambió mientras se generaba la respuesta. Reintenta para recuperar el resultado guardado.",
  invalid_stored_guide_answer:
    "El proveedor devolvió una respuesta no válida y no se guardó. Puedes reintentar la pregunta.",
  invalid_conversation_response:
    "El servidor devolvió un historial no válido. Recarga la página e inténtalo de nuevo.",
  invalid_conversation:
    "La conversación solicitada no es válida. Recarga el historial.",
  invalid_idempotency_key:
    "La solicitud no tenía una clave válida. Recarga e inténtalo de nuevo.",
  guide_storage_consent_required:
    "Debes autorizar el almacenamiento antes de continuar esta conversación.",
  ai_consent_required: "Debes autorizar el envío a la IA antes de preguntar.",
  invalid_guide_question: "La pregunta debe tener entre 1 y 500 caracteres.",
  invalid_guide_history:
    "El historial enviado no es válido. Limpia la vista e inténtalo de nuevo.",
  sensitive_guide_content:
    "No envíes claves, tokens ni credenciales en tus preguntas.",
  unexpected_fields:
    "La solicitud incluía datos no permitidos. Recarga e inténtalo de nuevo.",
  duplicate_operation:
    "La operación ya se había registrado. Recarga el historial para verla.",
  ai_provider_unconfigured:
    "El proveedor de IA no está configurado en el servidor.",
  ai_provider_auth_failed:
    "El proveedor rechazó la autenticación del servidor.",
  ai_provider_model_unavailable:
    "El modelo de IA no está disponible en este momento.",
  ai_provider_model_not_allowed:
    "El modelo de IA configurado no está permitido en el servidor.",
  ai_provider_model_not_verified:
    "El modelo de IA configurado no está verificado en el servidor.",
  ai_provider_no_verified_free_open_model:
    "No hay un modelo gratuito verificado disponible en el servidor.",
  ai_provider_invalid:
    "La configuración del proveedor de IA no es válida en el servidor.",
  ai_provider_unavailable:
    "El proveedor de IA no respondió. Reintenta más tarde.",
  ai_provider_rejected_request:
    "El proveedor no pudo aceptar la solicitud. Reformula la pregunta o reintenta.",
  invalid_ai_response:
    "El proveedor devolvió una respuesta no válida. Reintenta la pregunta.",
  guide_unavailable:
    "El proveedor de IA no está disponible. Reintenta la conexión.",
  invalid_guide_capabilities:
    "El servidor devolvió una comprobación de IA no válida. Reintenta la conexión.",
  pilot_api_error:
    "El servidor no pudo completar la operación. Reintenta más tarde.",
};

export function guideErrorMessage(cause: unknown): string {
  if (cause instanceof GuideApiError) {
    if (cause.status === 401)
      return "Tu sesión expiró. Inicia sesión de nuevo.";
    if (cause.status === 429)
      return `${guideQuotaMessages[cause.code] ?? "Alcanzaste un límite temporal."}${retryWaitSuffix(cause.retryAfterSeconds)}`;
    return (
      guideErrorMessages[cause.code] ??
      "No pudimos completar la operación. Reintenta más tarde."
    );
  }
  return "No pudimos conectar con EcoGuía. Revisa tu conexión y reintenta.";
}

// A missing session, a malformed request or a missing conversation cannot be
// fixed by repeating the same call. Limits require deleting or starting a new
// conversation first. Everything else (network, quota, storage, provider) can
// be retried with the same request key without duplicating work.
export function guideRetryable(cause: unknown): boolean {
  if (!(cause instanceof GuideApiError)) return true;
  if (cause.status === 400 || cause.status === 401 || cause.status === 404)
    return false;
  if (
    cause.code === "conversation_limit_reached" ||
    cause.code === "conversation_turn_limit_reached"
  )
    return false;
  return true;
}
