import type { Pool } from "pg";
import { uuidPattern } from "./pilotPolicy.ts";
import { digitalAssetForFulfillment } from "./rewardService.ts";
import { digitalAssetEvidence, digitalEvidenceNamespace, registeredDigitalAsset } from "./digitalAssetRegistry.ts";
export { digitalAssetCatalog, registeredDigitalAsset } from "./digitalAssetRegistry.ts";

export async function ownedDigitalAsset(pool: Pool, userId: string, redemptionId: string) {
  if (!userId || !uuidPattern.test(redemptionId)) return null;
  const result = await pool.query<{ fulfillment_status: string; fulfillment_reference: string | null; reward_reference?: string | null }>(
    `SELECT fulfillment_status, fulfillment_reference,
      (SELECT fulfillment_reference FROM rewards WHERE id=redemptions.reward_id) AS reward_reference
      FROM redemptions WHERE id=$1 AND user_id=$2`, [redemptionId, userId],
  );
  const row = result.rows[0];
  const key = row && digitalAssetForFulfillment(row.fulfillment_status, row.fulfillment_reference);
  if (row?.reward_reference?.startsWith(digitalEvidenceNamespace) && digitalAssetEvidence(row.reward_reference)?.key !== key) return null;
  return key ? registeredDigitalAsset(key) : null;
}
