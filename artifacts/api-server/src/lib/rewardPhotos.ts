import type { Pool } from "pg";
import { digitalAssetEvidence } from "./digitalAssetRegistry.ts";
import { RewardError } from "./rewardService.ts";
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
      title: string; description: string; active: boolean; inventory_remaining: number | null; fulfillment_reference: string | null;
      validated_at: Date | null; validated_by: string | null
    }>("SELECT title,description,active,inventory_remaining,fulfillment_reference,validated_at,validated_by FROM rewards WHERE id=$1 FOR UPDATE", [rewardId]);
    const reward = rows[0];
    if (!reward) throw new RewardError(404, "reward_not_found");
    // Prepare evidence before publication. Never replace the photographed
    // product of an already published/historical reward.
    if (reward.active || reward.validated_at || reward.validated_by || reward.fulfillment_reference ||
        digitalAssetEvidence(reward.fulfillment_reference)) {
      throw new RewardError(409, "reward_photo_requires_draft");
    }
    const previous = await client.query("SELECT image_url,source_url,confirmed_at,confirmed_by,product_title,product_description FROM reward_photos WHERE reward_id=$1",[rewardId]);
    const prior=previous.rows[0];
    if(prior && prior.image_url===input.imageUrl && prior.source_url===input.sourceUrl && prior.confirmed_by===actorId && prior.product_title===reward.title && prior.product_description===reward.description) {
      await client.query("COMMIT");
      return {rewardId,imageUrl:prior.image_url,sourceUrl:prior.source_url,confirmedAt:prior.confirmed_at};
    }
    await client.query(`INSERT INTO reward_photo_events(reward_id,actor_id,previous_photo,new_photo)
      SELECT $1,$2,(SELECT to_jsonb(p) FROM reward_photos p WHERE p.reward_id=$1),$3::jsonb`,
      [rewardId, actorId, JSON.stringify({ ...input, title: reward.title, description: reward.description })]);
    const result = await client.query<{ imageUrl: string; sourceUrl: string; confirmedAt: Date }>(`INSERT INTO reward_photos
      (reward_id,image_url,source_url,confirmed_by,product_title,product_description) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(reward_id) DO UPDATE SET image_url=EXCLUDED.image_url,source_url=EXCLUDED.source_url,
        confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now(),product_title=EXCLUDED.product_title,product_description=EXCLUDED.product_description
      RETURNING image_url AS "imageUrl", source_url AS "sourceUrl", confirmed_at AS "confirmedAt"`,
      [rewardId, input.imageUrl, input.sourceUrl, actorId, reward.title, reward.description]);
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
