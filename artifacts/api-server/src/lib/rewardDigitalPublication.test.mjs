import assert from "node:assert/strict";
import test from "node:test";
import { digitalAssetCatalog, digitalAssetEvidence } from "./digitalAssetRegistry.ts";
import { fulfillRedemption, parseRewardPublication, publishRewardDraft, validRewardEvidence } from "./rewardService.ts";
const id = "00000000-0000-4000-8000-000000000001";

for (const asset of digitalAssetCatalog()) {
  const expected = { title: asset.rewardTitle, description: "Descripción editable del propietario", cost: 30 };
  const input = { expected, digitalAssetKey: asset.key, inventoryRemaining: 7, availabilityConfirmed: true };
  test(asset.key + " publication binds its real file, digest, title and expressly declared digital capacity", async () => {
    const parsed = parseRewardPublication(input);
    assert.deepEqual(parsed, { expected, inventoryRemaining: 7, fulfillmentReference: asset.evidenceReference });
    assert.equal(validRewardEvidence(parsed.fulfillmentReference), true);
    const queries = [];
    const pool = { async connect() { return { release() {}, async query(sql, params = []) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
      if (sql.startsWith("SELECT role")) return { rows: [{ role: "admin" }] };
      if (sql.startsWith("SELECT id,title")) return { rows: [{ ...expected, id, active: false }] };
      if (sql.startsWith("UPDATE rewards")) {
        assert.deepEqual(params, [id, 7, asset.evidenceReference, "user_Admin"]);
        return { rows: [{ ...expected, id, active: true, inventoryRemaining: 7 }] };
      }
      throw Error("Unexpected SQL " + sql);
    } }; } };
    assert.equal((await publishRewardDraft(pool, "user_Admin", id, parsed)).reward.active, true);
    assert.equal(queries.at(-1).sql, "COMMIT");
    assert.equal(queries.filter(({sql}) => /^(INSERT|UPDATE|DELETE)/.test(sql)).length, 1);
    assert.ok(!queries.some(({sql}) => /point_movements|UPDATE redemptions|DELETE/.test(sql)));
  });
  test(asset.key + " rejects fabricated metadata, mismatched title and unconfirmed quotas", () => {
    for (const change of [
      { digitalAssetKey: "missing" }, { availabilityConfirmed: false }, { availabilityConfirmed: undefined },
      { inventoryRemaining: 0 }, { inventoryRemaining: 1.5 }, { inventoryRemaining: 100001 },
      { expected: { ...expected, title: "Archivo diferente" } },
      { fulfillmentReference: "https://example.org/fake" }, { contentType: "application/pdf" }, { sha256: "fake" },
    ]) assert.throws(() => parseRewardPublication({ ...input, ...change }), error => error.status === 400);
    assert.throws(() => parseRewardPublication({ expected, inventoryRemaining: 7, fulfillmentReference: "https://example.org/fake" }), { code: "digital_asset_required" });
  });
  test(asset.key + " fulfillment only grants its published file and never a different asset or a physical receipt", async () => {
    for (const reference of [asset.fulfillmentReference, "digital:ecopulse/missing", "physical_receipt_123"]) {
      const queries = [];
      const pool = { async connect() { return { release() {}, async query(sql, params) {
        queries.push(sql);
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
        if (sql.startsWith("SELECT role")) return { rows: [{ role: "admin" }] };
        if (sql.startsWith("SELECT id,fulfillment_status")) return { rows: [{ id, fulfillment_status: "reserved", reward_reference: asset.evidenceReference }] };
        if (sql.startsWith("UPDATE redemptions")) { assert.equal(params[1], asset.fulfillmentReference); return { rows: [] }; }
        throw Error("Unexpected SQL " + sql);
      } }; } };
      if (reference === asset.fulfillmentReference) {
        assert.equal((await fulfillRedemption(pool, "user_Admin", id, reference)).replayed, false);
        assert.equal(queries.at(-1), "COMMIT");
      } else {
        await assert.rejects(fulfillRedemption(pool, "user_Admin", id, reference), { code: "digital_asset_mismatch" });
        assert.ok(!queries.some(sql => sql.startsWith("UPDATE")));
        assert.equal(queries.at(-1), "ROLLBACK");
      }
    }
  });
}
test("modified or invented digital evidence cannot authorize redemption", () => {
  const asset = digitalAssetCatalog()[0];
  assert.equal(digitalAssetEvidence(asset.evidenceReference)?.key, asset.key);
  for (const reference of [asset.evidenceReference.replace(asset.sha256, "0".repeat(64)), asset.evidenceReference + "?other=1", asset.evidenceReference.replace("guide-v1", "unknown")]) {
    assert.equal(digitalAssetEvidence(reference), null);
    assert.equal(validRewardEvidence(reference), false);
  }
});
