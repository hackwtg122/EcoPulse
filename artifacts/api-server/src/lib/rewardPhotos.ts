import type { Pool } from "pg";
import { digitalAssetEvidence } from "./digitalAssetRegistry.ts";
import { hasRewardFulfillmentEvidence, RewardError } from "./rewardService.ts";
import { uuidPattern } from "./pilotPolicy.ts";

export type PhysicalRewardPhoto = { imageUrl: string; sourceUrl: string; photoConfirmed: true };

function safeHttps(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 800 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && url.href === value &&
      host.includes(".") && !host.endsWith(".local") && host !== "localhost" &&
      !/^\d+(?:\.\d+){3}$/.test(host) && !host.startsWith("[");
  } catch { return false; }
}

export function parsePhysicalRewardPhoto(raw: unknown): PhysicalRewardPhoto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RewardError(400, "invalid_reward_photo");
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).some(key => !["imageUrl", "sourceUrl", "photoConfirmed"].includes(key)) ||
      data.photoConfirmed !== true || !safeHttps(data.imageUrl) || !safeHttps(data.sourceUrl)) {
    throw new RewardError(400, "invalid_reward_photo");
  }
  return { imageUrl: data.imageUrl as string, sourceUrl: data.sourceUrl as string, photoConfirmed: true };
}

export async function hasRewardPhotoSchema(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ ready: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='reward_photos'
      AND obj_description(c.oid,'pg_class')='ecopulse:verified-physical-reward-photo:v1'
  ) AS ready`);
  return rows[0]?.ready === true;
}

export async function recordPhysicalRewardPhoto(pool: Pool, actorId: string, rewardId: string, input: PhysicalRewardPhoto) {
  if (!uuidPattern.test(rewardId)) throw new RewardError(400, "invalid_reward_id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query<{ role: string }>("SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE", [actorId]);
    if (actor.rows[0]?.role !== "admin") throw new RewardError(403, "admin_required");
    const { rows } = await client.query<{
      active: boolean; inventory_remaining: number | null; fulfillment_reference: string | null;
      validated_at: Date | null; validated_by: string | null
    }>("SELECT active,inventory_remaining,fulfillment_reference,validated_at,validated_by FROM rewards WHERE id=$1 FOR UPDATE", [rewardId]);
    const reward = rows[0];
    if (!reward) throw new RewardError(404, "reward_not_found");
    if (!reward.active || !Number.isInteger(reward.inventory_remaining) || Number(reward.inventory_remaining) < 1 ||
        !hasRewardFulfillmentEvidence(reward.fulfillment_reference, reward.validated_at, reward.validated_by) ||
        digitalAssetEvidence(reward.fulfillment_reference)) {
      throw new RewardError(409, "physical_reward_not_available");
    }
    const result = await client.query<{ imageUrl: string; sourceUrl: string; confirmedAt: Date }>(`INSERT INTO reward_photos
      (reward_id,image_url,source_url,confirmed_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT(reward_id) DO UPDATE SET image_url=EXCLUDED.image_url,source_url=EXCLUDED.source_url,
        confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now()
      RETURNING image_url AS "imageUrl", source_url AS "sourceUrl", confirmed_at AS "confirmedAt"`,
      [rewardId, input.imageUrl, input.sourceUrl, actorId]);
    await client.query("COMMIT");
    return { rewardId, ...result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code === "42501") throw new RewardError(503, "reward_photo_permissions_unavailable");
    if (code === "23505" || code === "23514" || code === "23503") throw new RewardError(409, "reward_photo_conflict");
    throw error;
  } finally {
    client.release();
  }
}
