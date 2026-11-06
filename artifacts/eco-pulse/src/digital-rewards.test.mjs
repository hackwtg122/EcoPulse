import assert from "node:assert/strict";
import test from "node:test";
import { loadDigitalRewardAssets, loadAdminRedemptions, publishRewardDraft } from "./reward-api.ts";
import { digitalAssetCatalog } from "../../api-server/src/lib/digitalAssetRegistry.ts";
const api = "https://example.org", id = "00000000-0000-4000-8000-000000000001";
const signal = () => new AbortController().signal;
test("digital publication sends the selected server asset and explicit capacity confirmation, not manual evidence", async () => {
  for (const asset of digitalAssetCatalog()) {
    const input = { expected: { title: asset.rewardTitle, description: "Unit", cost: 10 }, inventoryRemaining: 7, digitalAssetKey: asset.key, availabilityConfirmed: true };
    const result = await publishRewardDraft(api, "authorized-unit-token", id, input, signal(), async (url, options) => {
      assert.equal(url, `${api}/api/pilot/admin/rewards/${id}/publish`);
      assert.deepEqual(JSON.parse(options.body), input);
      assert.ok(!("fulfillmentReference" in JSON.parse(options.body)));
      return Response.json({ ...input.expected, id, active: true, inventoryRemaining: 7, validationRecorded: true, fulfillmentDocumented: true });
    });
    assert.equal(result.active, true);
  }
});
test("asset registry contracts describe real downloadable formats without embedding files", async () => {
  const assets = await loadDigitalRewardAssets(api, "unit", signal(), async () => Response.json(digitalAssetCatalog()));
  assert.equal(assets.length, 3);
  assert.ok(assets.every(asset => !Object.hasOwn(asset, "content")));
  await assert.rejects(loadDigitalRewardAssets(api, "unit", signal(), async () => Response.json([{ ...assets[0], sha256: "fake" }])), { code: "invalid_digital_asset_response" });
});
test("admin fulfillment uses only the bound recognized reference returned by the server", async () => {
  const base = { id, rewardId: id, rewardTitle: "Unit", cost: 10, createdAt: "2026-11-06T10:00:00Z", fulfillmentStatus: "reserved" };
  const list = await loadAdminRedemptions(api, "unit", signal(), async () => Response.json([
    { ...base, digitalFulfillmentReference: "digital:ecopulse/guide-v1" },
    { ...base, digitalFulfillmentReference: "digital:ecopulse/arbitrary" },
  ]));
  assert.equal(list[0].digitalFulfillmentReference, "digital:ecopulse/guide-v1");
  assert.equal(list[1].digitalFulfillmentReference, null);
});
