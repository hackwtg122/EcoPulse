import assert from "node:assert/strict";
import test from "node:test";
import { canEditRewardDraft, canRestockReward, recoverRewardDraft } from "./reward-api.ts";
const id = "00000000-0000-4000-8000-000000000001";
test("legacy validation metadata alone cannot enable restocking or claim availability", () => {
  const base = { id, title: "Unit", description: "Unit", cost: 20, active: true, inventoryRemaining: 10, validationRecorded: true, fulfillmentDocumented: true };
  assert.equal(canRestockReward(base), false);
  assert.equal(canRestockReward({ ...base, operationallyValidated: false }), false);
  assert.equal(canRestockReward({ ...base, operationallyValidated: true }), true);
  assert.equal(canRestockReward({ ...base, operationallyValidated: true, active: false, inventoryRemaining: 0 }), true);
});
test("only unvalidated inactive drafts are editable, never an exhausted validated reward", () => {
  const base = { id, title: "Unit", description: "Unit", cost: 20, active: false, inventoryRemaining: 0 };
  assert.equal(canEditRewardDraft(base), true);
  assert.equal(canEditRewardDraft({ ...base, validationRecorded: true }), false);
  assert.equal(canEditRewardDraft({ ...base, fulfillmentDocumented: true }), false);
  assert.equal(canEditRewardDraft({ ...base, active: true }), false);
});
test("recovery sends an authenticated idempotent request without invented stock or evidence", async () => {
  const result = await recoverRewardDraft("https://api.invalid", "unit-token", id, "recovery_test_key", new AbortController().signal, async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/pilot/admin/rewards/${id}/recover-draft`);
    assert.equal(options.method, "POST"); assert.equal(options.headers.Authorization, "Bearer unit-token");
    assert.equal(options.headers["Idempotency-Key"], "recovery_test_key"); assert.deepEqual(JSON.parse(options.body), {});
    return Response.json({ rewardId: id, replayed: true });
  });
  assert.deepEqual(result, { rewardId: id, replayed: true });
  await assert.rejects(recoverRewardDraft("https://api.invalid", "token", id, "recovery_test_key", new AbortController().signal,
    async () => Response.json({ rewardId: "other", replayed: false })), { code: "invalid_reward_recovery_response" });
});
