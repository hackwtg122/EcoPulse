import { useAuth } from "@clerk/react";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Trash2, UserRound } from "lucide-react";
import {
  askGuide,
  GuideApiError,
  guideQuotaMessages,
  loadGuideCapabilities,
  type GuideTurn,
} from "./guide-api";
import { retryWaitSuffix } from "./pilot-api";
import {
  askSavedGuide,
  createConversation,
  listConversations,
  readConversation,
  removeConversation,
  type ConversationSummary,
  type StoredGuideTurn,
} from "./guide-conversations-api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: string;
  source?: "ai";
};
type Intent = {
  question: string;
  history: GuideTurn[];
  saved?: { conversationId: string | null; key: string };
};
const welcome: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hola, soy EcoGuía. Puedo orientarte sobre separación de residuos y tu actividad real en EcoPulse.",
    timestamp: "Ahora",
  },
];
const time = (value: string) =>
  new Date(value).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
const errors: Record<string, string> = {
  guide_storage_migration_required:
    "El historial no está habilitado todavía en el servidor. Puedes conversar sin guardar.",
  guide_storage_unavailable:
    "No pudimos acceder al historial. No se ha confirmado el guardado; reintenta sin duplicar la pregunta.",
  guide_storage_configuration_required:
    "El historial requiere la conexión de base de datos con permisos limitados. Puedes conversar sin guardar mientras se configura.",
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
  guide_storage_consent_required:
    "Debes autorizar el almacenamiento antes de continuar esta conversación.",
  ai_consent_required: "Debes autorizar el envío a la IA antes de preguntar.",
  invalid_guide_question: "La pregunta debe tener entre 1 y 500 caracteres.",
  invalid_guide_history:
    "El historial enviado no es válido. Limpia la vista e inténtalo de nuevo.",
  sensitive_guide_content:
    "No envíes claves, tokens ni credenciales en tus preguntas.",
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
};
function historyMessages(turns: StoredGuideTurn[]): Message[] {
  return turns.flatMap((turn) => [
    {
      id: `u-${turn.id}`,
      role: "user" as const,
      content: turn.question,
      timestamp: time(turn.createdAt),
      status:
        turn.status === "pending"
          ? "Respuesta pendiente"
          : turn.status === "failed"
            ? "Sin respuesta guardada; puedes reintentar"
            : undefined,
    },
    ...(turn.status === "completed" && turn.answer
      ? [
          {
            id: `a-${turn.id}`,
            role: "assistant" as const,
            content: turn.answer,
            timestamp: time(turn.createdAt),
            source: "ai" as const,
          },
        ]
      : []),
  ]);
}
export function GuideConversationPanel({ apiUrl }: { apiUrl: string }) {
  const { getToken, userId } = useAuth();
  const [messages, setMessages] = useState<Message[]>(welcome);
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [storageConsent, setStorageConsent] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<Intent | null>(null);
  const [retryReason, setRetryReason] = useState<"pending" | "failed" | null>(
    null,
  );
  const [capabilityFailed, setCapabilityFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null);
  const gate = useRef(false);
  const creationKey = useRef(crypto.randomUUID());
  const showError = (cause: unknown) => {
    if (cause instanceof GuideApiError) {
      if (cause.status === 401)
        return "Tu sesión expiró. Inicia sesión de nuevo.";
      if (cause.status === 429)
        return `${guideQuotaMessages[cause.code] ?? "Alcanzaste un límite temporal."}${retryWaitSuffix(cause.retryAfterSeconds)}`;
      return (
        errors[cause.code] ??
        "No pudimos completar la operación. Reintenta más tarde."
      );
    }
    return "No pudimos conectar con EcoGuía. Revisa tu conexión y reintenta.";
  };
  const selectId = (id: string | null) => {
    setActiveId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    window.history.replaceState(window.history.state, "", url);
  };
  const showTurns = (id: string, turns: StoredGuideTurn[]) => {
    selectId(id);
    setMessages(turns.length ? historyMessages(turns) : welcome);
    const last = turns.at(-1);
    if (last && last.status !== "completed") {
      setRetry({
        question: last.question,
        history: [],
        saved: { conversationId: id, key: last.requestKey },
      });
      setRetryReason(last.status === "pending" ? "pending" : "failed");
    } else {
      setRetry(null);
      setRetryReason(null);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    gate.current = false;
    setPending(false);
    setMessages(welcome);
    setActiveId(null);
    setConversations([]);
    setConsent(false);
    setStorageConsent(false);
    setRetry(null);
    setRetryReason(null);
    setError("");
    setAiEnabled(false);
    setCapabilityFailed(false);
    setStorageReady(false);
    setLoading(true);
    creationKey.current = crypto.randomUUID();
    void (async () => {
      try {
        const token = await getToken();
        if (controller.signal.aborted) return;
        if (!token) throw new GuideApiError(401, "authentication_required");
        const capability = loadGuideCapabilities(
          apiUrl,
          token,
          controller.signal,
        )
          .then((enabled) => {
            if (!controller.signal.aborted) setAiEnabled(enabled);
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setCapabilityFailed(true);
              setError(
                "No pudimos comprobar el proveedor de IA. Reintenta la conexión.",
              );
            }
          });
        try {
          const rows = await listConversations(
            apiUrl,
            token,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setConversations(rows);
          setStorageReady(true);
          const requested = new URLSearchParams(window.location.search).get(
            "conversation",
          );
          const selected = rows.find((row) => row.id === requested) ?? rows[0];
          if (selected) {
            const turns = await readConversation(
              apiUrl,
              token,
              selected.id,
              controller.signal,
            );
            if (!controller.signal.aborted) showTurns(selected.id, turns);
          }
        } catch (cause) {
          if (!controller.signal.aborted) setError(showError(cause));
        }
        await capability;
      } catch (cause) {
        if (!controller.signal.aborted) setError(showError(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      request.current?.abort();
    };
    // All account data is cleared before loading the newly authenticated principal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, userId, getToken, reload]);
  const open = async (id: string) => {
    if (gate.current || loading) return;
    gate.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const token = await getToken();
      if (!token) throw new GuideApiError(401, "authentication_required");
      const turns = await readConversation(
        apiUrl,
        token,
        id,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        showTurns(id, turns);
        setStorageConsent(false);
        setInput("");
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(showError(cause));
    } finally {
      if (request.current === controller) {
        gate.current = false;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  };
  const startNew = () => {
    if (gate.current || loading) return;
    selectId(null);
    setMessages(welcome);
    setRetry(null);
    setRetryReason(null);
    setInput("");
    setError("");
    creationKey.current = crypto.randomUUID();
  };
  const remove = async (id: string) => {
    if (
      gate.current ||
      loading ||
      !window.confirm(
        "¿Eliminar definitivamente esta conversación y todas sus preguntas y respuestas guardadas?",
      )
    )
      return;
    gate.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const token = await getToken();
      if (!token) throw new GuideApiError(401, "authentication_required");
      await removeConversation(apiUrl, token, id, controller.signal);
      if (!controller.signal.aborted) {
        setConversations((rows) => rows.filter((row) => row.id !== id));
        if (activeId === id) {
          selectId(null);
          setMessages(welcome);
          setRetry(null);
          setRetryReason(null);
          creationKey.current = crypto.randomUUID();
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(showError(cause));
    } finally {
      if (request.current === controller) {
        gate.current = false;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  };
  const send = async (content = input, previous?: Intent) => {
    const question = previous?.question ?? content.trim();
    if (!question || question.length > 500 || gate.current || loading) return;
    if (!consent || !aiEnabled) {
      setError(
        "Autoriza el envío al proveedor de IA y comprueba su disponibilidad antes de preguntar.",
      );
      return;
    }
    if ((activeId || previous?.saved) && !storageConsent) {
      setError(
        "Para continuar guardando esta conversación, autoriza su almacenamiento; o inicia una conversación nueva sin guardar.",
      );
      return;
    }
    gate.current = true;
    setPending(true);
    setError("");
    setRetry(null);
    setRetryReason(null);
    const controller = new AbortController();
    request.current = controller;
    const history = messages
      .filter(
        (message) =>
          message.id !== "welcome" &&
          (message.role === "user" || message.source === "ai"),
      )
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content }));
    const intent: Intent = previous ?? {
      question,
      history,
      ...(storageConsent
        ? { saved: { conversationId: activeId, key: crypto.randomUUID() } }
        : {}),
    };
    if (!previous) {
      setMessages((rows) => [
        ...rows,
        {
          id: `u-${crypto.randomUUID()}`,
          role: "user",
          content: question,
          timestamp: "Ahora",
        },
      ]);
      setInput("");
    }
    try {
      const token = await getToken();
      if (controller.signal.aborted) return;
      if (!token) throw new GuideApiError(401, "authentication_required");
      if (intent.saved) {
        if (!intent.saved.conversationId)
          intent.saved.conversationId = await createConversation(
            apiUrl,
            token,
            creationKey.current,
            controller.signal,
          );
        const id = intent.saved.conversationId;
        if (controller.signal.aborted) return;
        selectId(id);
        await askSavedGuide(
          apiUrl,
          token,
          id,
          intent.question,
          intent.saved.key,
          controller.signal,
        );
        const turns = await readConversation(
          apiUrl,
          token,
          id,
          controller.signal,
        );
        if (!controller.signal.aborted) showTurns(id, turns);
        const rows = await listConversations(apiUrl, token, controller.signal);
        if (!controller.signal.aborted) setConversations(rows);
      } else {
        const answer = await askGuide(
          apiUrl,
          token,
          intent.question,
          intent.history,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setMessages((rows) => [
            ...rows,
            {
              id: `a-${crypto.randomUUID()}`,
              role: "assistant",
              content: answer,
              timestamp: "Ahora",
              source: "ai",
            },
          ]);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(showError(cause));
        setRetry(intent);
        setRetryReason("failed");
      }
    } finally {
      if (request.current === controller) {
        gate.current = false;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section
        className="rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"
        aria-label="Conversaciones guardadas"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl">Tus conversaciones</h2>
          <button
            type="button"
            disabled={pending || loading}
            onClick={startNew}
            className="text-sm font-semibold underline disabled:opacity-50"
            data-testid="button-new-guide-conversation"
          >
            Nueva conversación
          </button>
        </div>
        {loading && (
          <p role="status" className="mt-3 text-sm">
            Recuperando tu historial…
          </p>
        )}
        {!loading && conversations.length === 0 && (
          <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
            No hay conversaciones guardadas. Sin consentimiento, el chat solo
            permanece mientras esta página está abierta.
          </p>
        )}
        <ul className="mt-3 max-h-48 space-y-2 overflow-auto">
          {conversations.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm"
            >
              <button
                type="button"
                disabled={pending || loading}
                aria-pressed={activeId === row.id}
                onClick={() => void open(row.id)}
                data-testid={`guide-conversation-${row.id}`}
                className="text-left font-semibold disabled:opacity-50"
              >
                {time(row.updatedAt)} · {row.turnCount} preguntas{" "}
                {activeId === row.id ? "· abierta" : ""}
              </button>
              <button
                type="button"
                disabled={pending || loading}
                onClick={() => void remove(row.id)}
                aria-label="Eliminar conversación"
                data-testid={`delete-guide-conversation-${row.id}`}
                className="rounded-full p-2 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {!storageReady && !loading && (
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            className="mt-3 text-sm font-semibold underline"
            data-testid="button-retry-guide-history"
          >
            Reintentar historial
          </button>
        )}
      </section>
      <div className="overflow-hidden rounded-[2rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] p-5">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))]">
            <Bot size={22} />
          </span>
          <div>
            <p className="font-semibold">EcoGuía</p>
            <p className="text-xs text-[hsl(var(--primary))]">
              {aiEnabled
                ? "IA remota disponible con tu permiso"
                : "IA remota no disponible"}
            </p>
            {capabilityFailed && !loading && (
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className="mt-1 text-xs font-semibold underline"
                data-testid="button-retry-guide-capabilities"
              >
                Reintentar conexión
              </button>
            )}
          </div>
          <button
            disabled={pending || loading}
            onClick={startNew}
            className="ml-auto text-xs font-semibold disabled:opacity-50"
            data-testid="button-clear-chat"
          >
            Limpiar vista
          </button>
        </div>
        <label className="mx-5 mt-4 flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={!aiEnabled || pending}
            data-testid="guide-consent"
          />
          Permito enviar mis preguntas, hasta seis mensajes anteriores y un
          resumen de mi cuenta al proveedor de IA configurado. Sin permiso, no
          se enviará nada.
        </label>
        <label className="mx-5 mt-3 flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <input
            type="checkbox"
            checked={storageConsent}
            onChange={(event) => setStorageConsent(event.target.checked)}
            disabled={!storageReady || pending}
            data-testid="guide-storage-consent"
          />
          Autorizo guardar mis próximas preguntas y las respuestas en
          PostgreSQL, vinculadas a mi cuenta, para recuperarlas al volver. No
          incluyas contraseñas, tokens ni datos sensibles. Puedes eliminarlas
          desde tu historial.
        </label>
        <p className="mx-5 mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {activeId
            ? "Conversación guardada. Limpiar vista no elimina el historial; usa Eliminar conversación para borrarlo."
            : storageConsent
              ? "Las próximas preguntas se guardarán con tu consentimiento."
              : "Conversación sin guardar: se perderá al salir de esta vista."}
        </p>
        {(error || retry) && (
          <div
            role={error ? "alert" : "status"}
            className="mx-5 mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
          >
            {error ||
              (retryReason === "pending"
                ? "Hay una respuesta pendiente en el servidor. Si la conexión se interrumpió, podrás reintentarla tras cinco minutos sin duplicarla."
                : "La última pregunta quedó sin respuesta guardada. Puedes reintentarla sin duplicarla.")}
            {retry && (
              <button
                type="button"
                disabled={pending || loading}
                onClick={() => void send(retry.question, retry)}
                className="ml-3 font-semibold underline disabled:opacity-50"
                data-testid="button-retry-guide"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
        <div
          className="flex min-h-[390px] flex-col gap-4 p-5 sm:p-7"
          aria-live="polite"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex max-w-[88%] gap-2 ${message.role === "user" ? "ml-auto flex-row-reverse" : ""}`}
              data-testid={`message-${message.id}`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${message.role === "user" ? "bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--primary))]"}`}
              >
                {message.role === "user" ? (
                  <UserRound size={15} />
                ) : (
                  <Bot size={15} />
                )}
              </span>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "rounded-tr-sm bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "rounded-tl-sm bg-[hsl(var(--muted))]"}`}
              >
                <p className="whitespace-pre-line">{message.content}</p>
                <small className="mt-1 block text-[10px] opacity-60">
                  {message.timestamp}
                  {message.source === "ai" ? " · Respuesta IA" : ""}
                  {message.status ? ` · ${message.status}` : ""}
                </small>
              </div>
            </div>
          ))}
          {pending && (
            <p role="status" className="text-sm" data-testid="guide-typing">
              Procesando tu solicitud…
            </p>
          )}
        </div>
        <div className="border-t border-[hsl(var(--border))] p-4">
          <div className="mb-3 flex gap-2 overflow-auto">
            {[
              "¿Dónde va el vidrio?",
              "¿Cómo gano puntos?",
              "Busca un punto cerca",
              "Mi actividad",
            ].map((question) => (
              <button
                key={question}
                disabled={pending || loading}
                onClick={() => void send(question)}
                className="whitespace-nowrap rounded-full border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--primary))] disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={500}
              aria-label="Escribe tu duda para EcoGuía"
              placeholder="Escribe tu duda..."
              className="min-w-0 flex-1 rounded-full bg-[hsl(var(--muted))] px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/.35)]"
              data-testid="input-chat-message"
            />
            <button
              type="submit"
              disabled={pending || loading || !input.trim()}
              aria-label="Enviar pregunta"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              data-testid="button-send-chat"
            >
              <ArrowRight size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
