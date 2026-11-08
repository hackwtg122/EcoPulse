import type { Pool } from "pg";
import { digitalAssetEvidence } from "./digitalAssetRegistry.ts";

// An anonymous, read-only snapshot. Do not return user IDs, balances, scan logs,
// individual delivery histories, email addresses, or unvalidated center records.
export async function loadPublicImpact(pool: Pick<Pool, "query">) {
  const [aggregate, publishedPoints, publishedRewards] = await Promise.all([
    pool.query<{ centers: number; challenges: number; verified_deliveries: number }>(`
      SELECT
        (SELECT count(*)::int FROM delivery_points
          WHERE active=true AND validated_by IS NOT NULL AND validated_at IS NOT NULL) AS centers,
        (SELECT count(*)::int FROM eco_challenges WHERE active=true) AS challenges,
        (SELECT count(*)::int FROM deliveries WHERE status='approved') AS verified_deliveries`),
    pool.query<{ id: string; name: string; municipality: string; latitude: number | null; longitude: number | null }>(`
      SELECT id,name,municipality,latitude,longitude FROM delivery_points
      WHERE active=true AND validated_by IS NOT NULL AND validated_at IS NOT NULL
      ORDER BY name ASC LIMIT 25`),
    pool.query<{ id: string; title: string; cost: number; inventory_remaining: number; fulfillment_reference: string }>(`
      SELECT id,title,cost,inventory_remaining,fulfillment_reference FROM rewards
      WHERE active=true AND validated_by IS NOT NULL AND validated_at IS NOT NULL
        AND inventory_remaining>0 AND fulfillment_reference IS NOT NULL
      ORDER BY created_at DESC,id DESC`),
  ]);
  const counts = aggregate.rows[0];
  if (!counts) throw new Error("public_impact_unavailable");
  const rewards = publishedRewards.rows.flatMap(reward => {
    const asset = digitalAssetEvidence(reward.fulfillment_reference);
    if (!asset || !Number.isSafeInteger(reward.cost) || reward.cost < 1) return [];
    return [{
      id: reward.id,
      title: reward.title,
      cost: reward.cost,
      kind: asset.key,
    }];
  });
  return {
    centers: counts.centers,
    challenges: counts.challenges,
    rewards: rewards.length,
    verifiedDeliveries: counts.verified_deliveries,
    points: publishedPoints.rows.filter(point =>
      point.latitude != null && point.longitude != null &&
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180,
    ).map(point => ({
      id: point.id,
      name: point.name,
      municipality: point.municipality,
      latitude: point.latitude as number,
      longitude: point.longitude as number,
    })),
    featuredRewards: rewards.slice(0, 3),
  };
}
