import { GuideApiError } from "./guide-api";

export type ConversationSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
};
export type StoredGuideTurn = {
  id: string;
  question: string;
  answer: string | null;
  status: "pending" | "completed" | "failed";
  requestKey: string;
  createdAt: string;
};
export type SavedGuideAnswer = {
  turnId: string;
  answer: string;
  source: "ai";
  persisted: true;
  replayed: boolean;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GuideApiError(502, "invalid_conversation_response");
  return value as Record<string, unknown>;
};
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new GuideApiError(502, "invalid_conversation_response");
}
async function request(
  api: string,
  token: string,
  path: string,
  signal: AbortSignal,
  method = "GET",
  body?: object,
  key?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${api}/api/pilot/guide/conversations${path}`, {
    method,
    signal,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method === "POST"
        ? { "X-AI-Storage-Consent": "true", "Idempotency-Key": key! }
        : {}),
      ...(path.endsWith("/messages") ? { "X-AI-Consent": "true" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new GuideApiError(
      response.status,
      typeof (payload as { error?: unknown })?.error === "string"
        ? (payload as { error: string }).error
        : "guide_storage_unavailable",
      typeof (payload as { retryAfterSeconds?: unknown })?.retryAfterSeconds ===
        "number" &&
        Number.isFinite(
          (payload as { retryAfterSeconds: number }).retryAfterSeconds,
        ) &&
        (payload as { retryAfterSeconds: number }).retryAfterSeconds > 0
        ? Math.ceil(
            (payload as { retryAfterSeconds: number }).retryAfterSeconds,
          )
        : 0,
    );
  return object(payload);
}
export async function listConversations(
  api: string,
  token: string,
  signal: AbortSignal,
): Promise<ConversationSummary[]> {
  const body = await request(api, token, "", signal);
  if (!Array.isArray(body.conversations) || body.conversations.length > 50)
    throw new GuideApiError(502, "invalid_conversation_response");
  return body.conversations.map((value) => {
    const row = object(value);
    id(row.id);
    if (
      typeof row.createdAt !== "string" ||
      typeof row.updatedAt !== "string" ||
      !Number.isInteger(row.turnCount) ||
      Number(row.turnCount) < 0 ||
      Number(row.turnCount) > 100
    )
      throw new GuideApiError(502, "invalid_conversation_response");
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      turnCount: Number(row.turnCount),
    };
  });
}
export async function createConversation(
  api: string,
  token: string,
  key: string,
  signal: AbortSignal,
): Promise<string> {
  const body = await request(api, token, "", signal, "POST", {}, key);
  id(body.id);
  return body.id;
}
export async function readConversation(
  api: string,
  token: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<StoredGuideTurn[]> {
  id(conversationId);
  const body = await request(api, token, `/${conversationId}`, signal);
  if (
    body.id !== conversationId ||
    !Array.isArray(body.turns) ||
    body.turns.length > 100
  )
    throw new GuideApiError(502, "invalid_conversation_response");
  return body.turns.map((value) => {
    const row = object(value);
    id(row.id);
    if (
      typeof row.question !== "string" ||
      !row.question.trim() ||
      row.question.length > 500 ||
      typeof row.createdAt !== "string" ||
      typeof row.requestKey !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(row.requestKey) ||
      !["pending", "completed", "failed"].includes(String(row.status))
    )
      throw new GuideApiError(502, "invalid_conversation_response");
    if (
      row.status === "completed"
        ? typeof row.answer !== "string" ||
          !row.answer.trim() ||
          row.answer.length > 800
        : row.answer !== null
    )
      throw new GuideApiError(502, "invalid_conversation_response");
    return {
      id: row.id,
      question: row.question,
      answer: row.answer as string | null,
      status: row.status as StoredGuideTurn["status"],
      requestKey: row.requestKey,
      createdAt: row.createdAt,
    };
  });
}
export async function askSavedGuide(
  api: string,
  token: string,
  conversationId: string,
  question: string,
  key: string,
  signal: AbortSignal,
): Promise<SavedGuideAnswer> {
  id(conversationId);
  const body = await request(
    api,
    token,
    `/${conversationId}/messages`,
    signal,
    "POST",
    { question },
    key,
  );
  id(body.turnId);
  if (
    body.source !== "ai" ||
    body.persisted !== true ||
    typeof body.replayed !== "boolean" ||
    typeof body.answer !== "string" ||
    !body.answer.trim() ||
    body.answer.length > 800
  )
    throw new GuideApiError(502, "invalid_conversation_response");
  return body as SavedGuideAnswer;
}
export async function removeConversation(
  api: string,
  token: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<void> {
  id(conversationId);
  const body = await request(
    api,
    token,
    `/${conversationId}`,
    signal,
    "DELETE",
  );
  if (body.id !== conversationId || body.deleted !== true)
    throw new GuideApiError(502, "invalid_conversation_response");
}
