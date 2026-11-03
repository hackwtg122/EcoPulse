import type { Pool } from "pg";
import { uuidPattern } from "./pilotPolicy.ts";
import { digitalAssetForFulfillment } from "./rewardService.ts";

// The previews in the public frontend are not the delivered files.
const assets: Record<string, { filename: string; contentType: string; content: string }> = {
  "nature-v1": { filename: "ecopulse-naturaleza.svg", contentType: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#d5eee4"/><circle cx="920" cy="155" r="80" fill="#f3d780"/><path d="M0 500 260 230 520 475 760 300 1200 520v155H0" fill="#438a6e"/><path d="M0 570 320 420 620 590 930 390 1200 550v125H0" fill="#205f48"/><text x="60" y="625" fill="white" font-family="sans-serif" font-size="42">EcoPulse</text></svg>' },
  "badge-v1": { filename: "ecopulse-insignia.svg", contentType: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#e4f3e8"/><circle cx="300" cy="280" r="210" fill="#fff" stroke="#205f48" stroke-width="14"/><path d="M300 390C180 325 195 180 355 145c5 95-20 165-100 205M305 355c35-80 110-105 145-65-22 65-72 90-145 85" fill="#438a6e"/><text x="300" y="540" text-anchor="middle" fill="#205f48" font-family="sans-serif" font-size="38">EcoPulse</text></svg>' },
};

export async function ownedDigitalAsset(pool: Pool, userId: string, redemptionId: string) {
  if (!userId || !uuidPattern.test(redemptionId)) return null;
  const result = await pool.query<{ fulfillment_status: string; fulfillment_reference: string | null }>(
    "SELECT fulfillment_status, fulfillment_reference FROM redemptions WHERE id=$1 AND user_id=$2", [redemptionId, userId],
  );
  const row = result.rows[0];
  const key = row && digitalAssetForFulfillment(row.fulfillment_status, row.fulfillment_reference);
  return key ? assets[key] ?? null : null;
}
