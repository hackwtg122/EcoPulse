import assert from "node:assert/strict";
import test from "node:test";
import { loadRewardCapabilities, loadRewardInventoryHistory, restockRewardInventory } from "./reward-api.ts";
import { readRestockIntent, saveRestockIntent, clearRestockIntent } from "./reward-inventory-intent.ts";

const id = "00000000-0000-4000-8000-000000000001";
const input = { quantity: 3, evidenceReference: "https://example.org/stock-evidence", availabilityConfirmed: true };
const movement = { id, rewardId: id, administratorId: "user_TestAdmin", quantity: 3, inventoryBefore: 10, inventoryAfter: 13,
  evidenceReference: input.evidenceReference, createdAt: "2026-11-04T12:00:00Z" };
const signal = new AbortController().signal;
test("restock sends only authorized evidence and quantity with a stable idempotency key", async () => {
  const result = await restockRewardInventory("https://api.invalid", "test-token", id, "restock_key_01", input, signal, async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/pilot/admin/rewards/${id}/restock`);
    assert.equal(options.method, "POST"); assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.headers["Idempotency-Key"], "restock_key_01");
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json({ movement, replayed: true });
  });
  assert.deepEqual(result, { movement, replayed: true });
});
test("unconfirmed or inconsistent inventory responses cannot report success", async () => {
  for (const changes of [{ quantity: 4 }, { inventoryAfter: 99 }, { rewardId: "00000000-0000-4000-8000-000000000002" }, { administratorId: "" }]) {
    await assert.rejects(restockRewardInventory("https://api.invalid", "token", id, "restock_key_01", input, signal,
      async () => Response.json({ movement: { ...movement, ...changes }, replayed: false })), { code: "invalid_inventory_response" });
  }
  await assert.rejects(restockRewardInventory("https://api.invalid", "token", id, "restock_key_01", { ...input, availabilityConfirmed: false }, signal,
    async () => { throw Error("must_not_fetch"); }), { code: "invalid_inventory_request" });
});
test("inventory history is paginated, authenticated, scoped to its reward and read-only", async () => {
  const result = await loadRewardInventoryHistory("https://api.invalid", "test-token", id, "cursor_test_key", signal, async (url, options) => {
    assert.equal(new URL(url).searchParams.get("cursor"), "cursor_test_key");
    assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
    return Response.json({ items: [movement], nextCursor: null });
  });
  assert.deepEqual(result.items, [movement]);
  await assert.rejects(loadRewardInventoryHistory("https://api.invalid", "token", id, null, signal,
    async () => Response.json({ items: [{ ...movement, rewardId: "00000000-0000-4000-8000-000000000002" }], nextCursor: null })), { code: "invalid_inventory_response" });
});
test("new inventory capabilities fail closed with an older or malformed server response", async () => {
  const caps = { canRedeem: true, canManageDrafts: true, canPublish: true, canFulfill: true, schemaReady: true };
  const old = await loadRewardCapabilities("https://api.invalid", "token", signal, async () => Response.json(caps));
  assert.equal(old.canRestock, false); assert.equal(old.inventorySchemaReady, false);
  await assert.rejects(loadRewardCapabilities("https://api.invalid", "token", signal, async () => Response.json({ ...caps, canRestock: "true" })), { code: "invalid_reward_capabilities" });
});
test("pending restocks survive reload only for their administrator and retain original payload and key", () => {
  const values = new Map();
  const storage = () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });
  const intent = { rewardId: id, key: "restock_key_01", input };
  saveRestockIntent("user_TestAdmin", intent, storage);
  assert.deepEqual(readRestockIntent("user_TestAdmin", storage), intent);
  assert.equal(readRestockIntent("user_Other", storage), null);
  clearRestockIntent("user_TestAdmin", storage); assert.equal(readRestockIntent("user_TestAdmin", storage), null);
  assert.doesNotThrow(() => saveRestockIntent("user_TestAdmin", intent, () => { throw Error("storage blocked"); }));
});
