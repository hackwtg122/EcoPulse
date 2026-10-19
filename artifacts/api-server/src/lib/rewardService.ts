import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { uuidPattern, validIdempotencyKey } from "./pilotPolicy.ts";

export class RewardError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export type RewardDraft = { title: string; description: string; cost: number };
export function parseRewardDraft(value: unknown): RewardDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RewardError(400, "invalid_reward");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["title", "description", "cost"].includes(key))) throw new RewardError(400, "unexpected_fields");
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const description = typeof row.description === "string" ? row.description.trim() : "";
  if (title.length < 1 || title.length > 120 || description.length < 1 || description.length > 500 ||
    !Number.isSafeInteger(row.cost) || (row.cost as number) < 1 || (row.cost as number) > 100_000) {
    throw new RewardError(400, "invalid_reward");
  }
  return { title, description, cost: row.cost as number };
}

export function rewardIdForKey(userId: string, key: unknown): string {
  if (!validIdempotencyKey(key)) throw new RewardError(400, "invalid_idempotency_key");
  const bytes = createHash("sha256").update("ecopulse:reward-draft\0").update(userId).update("\0").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function redemptionActionsEnabled(flags: { rewards?: string; points?: string; fulfillment?: string; policyReference?: string }, schemaReady: boolean): boolean {
  return schemaReady && flags.rewards === "true" && flags.points === "true" && flags.fulfillment === "true"
    && typeof flags.policyReference === "string" && /^[A-Za-z0-9_:/.-]{10,120}$/.test(flags.policyReference);
}

export async function hasRewardFulfillmentSchema(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ ready: boolean }>(`SELECT
    to_regclass('public.rewards') IS NOT NULL AND to_regclass('public.redemptions') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rewards' AND column_name='inventory_remaining')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='redemptions' AND column_name='fulfillment_status') AS ready`);
  return result.rows[0]?.ready === true;
}

async function transaction<T>(pool: Pool, task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code === "42501") throw new RewardError(503, "reward_permissions_unavailable");
    if (code === "23505" || code === "23514" || code === "23503") throw new RewardError(409, "reward_conflict");
    throw error;
  } finally { client.release(); }
}

export async function createRewardDraft(pool: Pool, actorId: string, key: unknown, input: RewardDraft) {
  const id = rewardIdForKey(actorId, key);
  return transaction(pool, async client => {
    const inserted = await client.query(`INSERT INTO rewards (id,title,description,cost) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO NOTHING RETURNING id,title,description,cost,active`, [id,input.title,input.description,input.cost]);
    const row = inserted.rows[0] ?? (await client.query("SELECT id,title,description,cost,active FROM rewards WHERE id=$1", [id])).rows[0];
    if (!row || row.title !== input.title || row.description !== input.description || row.cost !== input.cost) {
      throw new RewardError(409, "idempotency_key_reused");
    }
    return { reward: row, replayed: inserted.rowCount === 0 };
  });
}

export async function editRewardDraft(pool: Pool, id: string, expected: RewardDraft, input: RewardDraft) {
  if (!uuidPattern.test(id)) throw new RewardError(400, "invalid_reward_id");
  const result = await pool.query(`UPDATE rewards SET title=$3, description=$4, cost=$5
    WHERE id=$1 AND active=false AND title=$2 AND description=$6 AND cost=$7
    RETURNING id,title,description,cost,active`, [id,expected.title,input.title,input.description,input.cost,expected.description,expected.cost]);
  if (!result.rows[0]) throw new RewardError(409, "reward_changed_or_unavailable");
  return result.rows[0];
}

export async function redeemReward(pool: Pool, userId: string, rewardId: string, key: unknown) {
  if (!uuidPattern.test(rewardId) || !validIdempotencyKey(key)) throw new RewardError(400, "invalid_redemption");
  return transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [userId]);
    const owner = await client.query("SELECT clerk_user_id FROM users WHERE clerk_user_id=$1", [userId]);
    if (!owner.rows[0]) throw new RewardError(401, "account_unavailable");
    const prior = await client.query("SELECT id,reward_id,cost,created_at,fulfillment_status FROM redemptions WHERE user_id=$1 AND idempotency_key=$2", [userId,key]);
    if (prior.rows[0]) {
      if (prior.rows[0].reward_id !== rewardId) throw new RewardError(409, "idempotency_key_reused");
      return { redemption: prior.rows[0], replayed: true };
    }
    const reward = await client.query<{ cost: number; inventory_remaining: number; active: boolean }>(`SELECT cost,inventory_remaining,active FROM rewards WHERE id=$1 FOR UPDATE`, [rewardId]);
    const item = reward.rows[0];
    if (!item || !item.active || !Number.isSafeInteger(item.inventory_remaining) || item.inventory_remaining < 1) throw new RewardError(404, "reward_unavailable");
    const balanceResult = await client.query<{ balance: string }>("SELECT coalesce(sum(delta),0)::text AS balance FROM point_movements WHERE user_id=$1", [userId]);
    const balance = Number(balanceResult.rows[0]?.balance ?? "0");
    if (!Number.isSafeInteger(balance)) throw new RewardError(500, "balance_out_of_range");
    if (balance < item.cost) throw new RewardError(409, "insufficient_points");
    const redemptionId = randomUUID();
    const redemption = await client.query(`INSERT INTO redemptions (id,user_id,reward_id,cost,idempotency_key)
      VALUES ($1,$2,$3,$4,$5) RETURNING id,reward_id,cost,created_at,fulfillment_status`, [redemptionId,userId,rewardId,item.cost,key]);
    await client.query("INSERT INTO point_movements (id,user_id,delta,kind,source_id) VALUES ($1,$2,$3,'redemption',$4)", [randomUUID(),userId,-item.cost,redemptionId]);
    await client.query("UPDATE rewards SET inventory_remaining=inventory_remaining-1,active=(inventory_remaining>1),updated_at=now() WHERE id=$1", [rewardId]);
    return { redemption: redemption.rows[0], replayed: false };
  });
}

export async function listReservedRedemptions(pool: Pool) {
  const rows = await pool.query(`SELECT r.id, r.reward_id AS "rewardId", w.title AS "rewardTitle", r.cost,
    r.created_at AS "createdAt", r.fulfillment_status AS "fulfillmentStatus"
    FROM redemptions r JOIN rewards w ON w.id=r.reward_id
    WHERE r.fulfillment_status='reserved' ORDER BY r.created_at ASC, r.id ASC LIMIT 100`);
  return rows.rows;
}

export async function fulfillRedemption(pool: Pool, actorId: string, id: string, reference: string) {
  if (!uuidPattern.test(id) || !/^[A-Za-z0-9_:/.-]{10,120}$/.test(reference)) throw new RewardError(400, "invalid_fulfillment_reference");
  return transaction(pool, async client => {
    const result = await client.query("SELECT id,fulfillment_status,fulfillment_reference,fulfilled_by FROM redemptions WHERE id=$1 FOR UPDATE", [id]);
    const prior = result.rows[0];
    if (!prior) throw new RewardError(404, "redemption_not_found");
    if (prior.fulfillment_status === "fulfilled") {
      if (prior.fulfillment_reference !== reference || prior.fulfilled_by !== actorId) throw new RewardError(409, "already_fulfilled");
      return { id, replayed: true };
    }
    if (prior.fulfillment_status !== "reserved") throw new RewardError(409, "redemption_state_conflict");
    await client.query(`UPDATE redemptions SET fulfillment_status='fulfilled',fulfillment_reference=$2,fulfilled_by=$3,fulfilled_at=now()
      WHERE id=$1`, [id,reference,actorId]);
    return { id, replayed: false };
  });
}
