import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { uuidPattern, validIdempotencyKey } from "./pilotPolicy.ts";
import { parseGuideRequest, type GuideRequest } from "./aiGuideCore.ts";

export class GuideStorageError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const sensitive =
  /-----BEGIN[^\n]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{16,}|\bsk-[A-Za-z0-9_-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i;
export function parseStoredQuestion(body: unknown): string {
  const request = parseGuideRequest(body);
  // Stored history is always reconstructed server-side, never supplied by client.
  if (Object.keys(body as object).some((key) => key !== "question"))
    throw new GuideStorageError(400, "unexpected_fields");
  if (sensitive.test(request.question))
    throw new GuideStorageError(400, "sensitive_guide_content");
  return request.question;
}
function principal(userId: string) {
  if (!/^user_[A-Za-z0-9]{3,64}$/.test(userId))
    throw new GuideStorageError(401, "authentication_required");
}
function identifier(id: string) {
  if (!uuidPattern.test(id))
    throw new GuideStorageError(400, "invalid_conversation");
}
function key(value: unknown): asserts value is string {
  if (!validIdempotencyKey(value))
    throw new GuideStorageError(400, "invalid_idempotency_key");
}
async function transaction<T>(
  pool: Pool,
  userId: string,
  task: (client: PoolClient) => Promise<T>,
): Promise<T> {
  principal(userId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SELECT set_config('app.guide_user_id',$1,true)", [
      userId,
    ]);
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof GuideStorageError) throw error;
    // Never leak SQL parameters, questions, answers or account IDs to logger.
    throw new GuideStorageError(503, "guide_storage_unavailable");
  } finally {
    client.release();
  }
}
async function ownConversation(client: PoolClient, userId: string, id: string) {
  identifier(id);
  const result = await client.query(
    "SELECT id FROM public.guide_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE",
    [id, userId],
  );
  if (!result.rowCount)
    throw new GuideStorageError(404, "conversation_not_found");
}
export async function hasGuideStorage(pool: Pool): Promise<boolean> {
  const result =
    await pool.query(`SELECT to_regclass('public.guide_conversations') IS NOT NULL
    AND to_regclass('public.guide_turns') IS NOT NULL AS ready`);
  return result.rows[0]?.ready === true;
}
export async function listGuideConversations(pool: Pool, userId: string) {
  return transaction(
    pool,
    userId,
    async (client) =>
      (
        await client.query(
          `SELECT c.id,c.created_at AS "createdAt",c.updated_at AS "updatedAt",
    (SELECT count(*)::int FROM public.guide_turns t WHERE t.conversation_id=c.id AND t.user_id=$1) AS "turnCount"
    FROM public.guide_conversations c WHERE c.user_id=$1 ORDER BY c.updated_at DESC,c.id LIMIT 50`,
          [userId],
        )
      ).rows,
  );
}
export async function createGuideConversation(
  pool: Pool,
  userId: string,
  creationKey: unknown,
) {
  key(creationKey);
  return transaction(pool, userId, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,741926238))",
      [userId],
    );
    const prior = await client.query(
      'SELECT id,created_at AS "createdAt",updated_at AS "updatedAt" FROM public.guide_conversations WHERE user_id=$1 AND creation_key=$2',
      [userId, creationKey],
    );
    if (prior.rows[0]) return { ...prior.rows[0], replayed: true };
    const count = await client.query(
      "SELECT count(*)::int AS count FROM public.guide_conversations WHERE user_id=$1",
      [userId],
    );
    if (count.rows[0].count >= 50)
      throw new GuideStorageError(409, "conversation_limit_reached");
    const created = await client.query(
      'INSERT INTO public.guide_conversations(id,user_id,creation_key) VALUES($1,$2,$3) RETURNING id,created_at AS "createdAt",updated_at AS "updatedAt"',
      [randomUUID(), userId, creationKey],
    );
    return { ...created.rows[0], replayed: false };
  });
}
export async function readGuideConversation(
  pool: Pool,
  userId: string,
  id: string,
) {
  return transaction(pool, userId, async (client) => {
    await ownConversation(client, userId, id);
    const turns = await client.query(
      `SELECT id,question,answer,status,request_key AS "requestKey",created_at AS "createdAt"
      FROM public.guide_turns WHERE conversation_id=$1 AND user_id=$2 ORDER BY created_at,id LIMIT 100`,
      [id, userId],
    );
    return { id, turns: turns.rows };
  });
}
export async function deleteGuideConversation(
  pool: Pool,
  userId: string,
  id: string,
) {
  return transaction(pool, userId, async (client) => {
    await ownConversation(client, userId, id);
    await client.query(
      "DELETE FROM public.guide_conversations WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
    return { id, deleted: true };
  });
}
export async function answerStoredGuideQuestion(
  pool: Pool,
  userId: string,
  conversationId: string,
  requestKey: unknown,
  question: string,
  answer: (request: GuideRequest) => Promise<{ answer: string; source: "ai" }>,
) {
  key(requestKey);
  const hash = createHash("sha256").update(question).digest("hex");
  const reservation = await transaction(pool, userId, async (client) => {
    await ownConversation(client, userId, conversationId);
    const previous = await client.query(
      "SELECT id,question_hash,answer,status FROM public.guide_turns WHERE conversation_id=$1 AND user_id=$2 AND request_key=$3",
      [conversationId, userId, requestKey],
    );
    const prior = previous.rows[0];
    if (prior && prior.question_hash !== hash)
      throw new GuideStorageError(409, "guide_idempotency_conflict");
    if (prior?.status === "completed")
      return {
        replay: {
          turnId: prior.id,
          answer: prior.answer as string,
          source: "ai" as const,
          persisted: true,
          replayed: true,
        },
      };
    // An abandoned inference can be retried after five minutes. attempt_id
    // fences out late completions from the old worker, including after deploys.
    await client.query(
      "UPDATE public.guide_turns SET status='failed',updated_at=now() WHERE conversation_id=$1 AND user_id=$2 AND status='pending' AND updated_at<now()-interval '5 minutes'",
      [conversationId, userId],
    );
    const busy = await client.query(
      "SELECT id FROM public.guide_turns WHERE conversation_id=$1 AND user_id=$2 AND status='pending'",
      [conversationId, userId],
    );
    if (busy.rowCount)
      throw new GuideStorageError(409, "guide_conversation_busy");
    const attemptId = randomUUID(),
      turnId = prior?.id ?? randomUUID();
    if (prior) {
      await client.query(
        "UPDATE public.guide_turns SET status='pending',attempt_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2",
        [turnId, userId, attemptId],
      );
    } else {
      const count = await client.query(
        "SELECT count(*)::int AS count FROM public.guide_turns WHERE conversation_id=$1 AND user_id=$2",
        [conversationId, userId],
      );
      if (count.rows[0].count >= 100)
        throw new GuideStorageError(409, "conversation_turn_limit_reached");
      await client.query(
        "INSERT INTO public.guide_turns(id,conversation_id,user_id,request_key,question_hash,question,status,attempt_id) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)",
        [turnId, conversationId, userId, requestKey, hash, question, attemptId],
      );
    }
    const history = await client.query<{ question: string; answer: string }>(
      "SELECT question,answer FROM public.guide_turns WHERE conversation_id=$1 AND user_id=$2 AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 3",
      [conversationId, userId],
    );
    return {
      turnId,
      attemptId,
      history: history.rows.reverse().flatMap((row) => [
        { role: "user" as const, content: row.question.slice(0, 300) },
        { role: "assistant" as const, content: row.answer.slice(0, 300) },
      ]),
    };
  });
  if (reservation.replay) return reservation.replay;
  try {
    const result = await answer({
      question,
      history: reservation.history!,
      materialContext: "",
    });
    if (
      result.source !== "ai" ||
      !result.answer.trim() ||
      result.answer.length > 800 ||
      sensitive.test(result.answer)
    )
      throw new GuideStorageError(502, "invalid_stored_guide_answer");
    return await transaction(pool, userId, async (client) => {
      await ownConversation(client, userId, conversationId);
      const updated = await client.query(
        "UPDATE public.guide_turns SET answer=$4,status='completed',updated_at=now() WHERE id=$1 AND user_id=$2 AND attempt_id=$3 AND status='pending' RETURNING id",
        [reservation.turnId, userId, reservation.attemptId, result.answer],
      );
      if (!updated.rowCount)
        throw new GuideStorageError(409, "guide_turn_changed");
      await client.query(
        "UPDATE public.guide_conversations SET updated_at=now() WHERE id=$1 AND user_id=$2",
        [conversationId, userId],
      );
      return {
        turnId: reservation.turnId,
        answer: result.answer,
        source: "ai" as const,
        persisted: true,
        replayed: false,
      };
    });
  } catch (error) {
    await transaction(pool, userId, async (client) => {
      await client.query(
        "UPDATE public.guide_turns SET status='failed',updated_at=now() WHERE id=$1 AND user_id=$2 AND attempt_id=$3 AND status='pending'",
        [reservation.turnId, userId, reservation.attemptId],
      );
    }).catch(() => {});
    throw error;
  }
}
