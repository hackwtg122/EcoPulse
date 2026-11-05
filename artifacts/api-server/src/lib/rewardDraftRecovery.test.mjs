import assert from "node:assert/strict";
import test from "node:test";
import { adminRewardView, recoverRewardDraft, editRewardDraft } from "./rewardService.ts";

const rewardId = "00000000-0000-4000-8000-000000000001";
test("administrative reward snapshots preserve stored descriptions for edit/publication comparisons", () => {
  const row = { id: rewardId, title: "Kit digital de reciclaje", description: "Descripción redactada por el administrador", cost: 60,
    active: true, inventoryRemaining: 5, fulfillmentDocumented: true, validationRecorded: true,
    fulfillment_reference: "legacy:unconfirmed", validated_at: new Date(), validated_by: "user_Admin", hasOperations: false };
  const view = adminRewardView(row);
  assert.equal(view.title, row.title); assert.equal(view.description, row.description); assert.equal(view.cost, row.cost);
  assert.equal(view.draftRecoveryAvailable, true); assert.equal(view.operationallyValidated, false);
  assert.ok(!("validated_by" in view)); assert.ok(!("fulfillment_reference" in view));
  assert.equal(adminRewardView({ ...row, hasOperations: true }).draftRecoveryAvailable, false);
  assert.equal(adminRewardView({ ...row, fulfillment_reference: "https://example.org/evidence" }).draftRecoveryAvailable, false);
});
function poolFor({ role = "admin", used = false, operational = false, failReset = false } = {}) {
  const state = { snapshot: { id: rewardId, title: "Unit test only", description: "Isolated fixture", cost: 20, active: true,
    inventory_remaining: 10, fulfillment_reference: operational ? "https://example.org/real-evidence" : "legacy:unconfirmed", validated_at: "2026-11-05T00:00:00Z", validated_by: "user_Admin" }, audit: [] };
  const queries = [], tails = new Map();
  async function lock(id) { const prior = tails.get(id) ?? Promise.resolve(); let release; const next = new Promise(resolve => release = resolve); tails.set(id, next); await prior; return release; }
  return { state, queries, async connect() {
    const unlocks = []; let pending = null;
    const release = () => unlocks.splice(0).forEach(fn => fn());
    return { release, async query(raw, params = []) {
      const sql = raw.trim(); queries.push(sql);
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "COMMIT") { if (pending) { state.snapshot = pending.snapshot; state.audit.push(...pending.audit); } release(); return { rows: [] }; }
      if (sql === "ROLLBACK") { pending = null; release(); return { rows: [] }; }
      if (sql.startsWith("SELECT role")) return { rows: role ? [{ role }] : [] };
      if (sql.startsWith("SELECT pg_advisory")) { unlocks.push(await lock(params[0])); return { rows: [] }; }
      if (sql.startsWith("SELECT reward_id FROM reward_draft_recoveries")) return { rows: state.audit.filter(row => row.actor === params[0] && row.key === params[1]).map(row => ({ reward_id: row.rewardId })) };
      if (sql.startsWith("SELECT to_jsonb(r)")) { unlocks.push(await lock("reward")); pending = { snapshot: structuredClone(state.snapshot), audit: [] }; return { rows: [{ snapshot: pending.snapshot }] }; }
      if (sql.startsWith("SELECT EXISTS(SELECT 1 FROM redemptions")) return { rows: [{ used }] };
      if (sql.startsWith("INSERT INTO reward_draft_recoveries")) { pending.audit.push({ rewardId: params[1], actor: params[2], key: params[3], previous: JSON.parse(params[4]) }); return { rows: [] }; }
      if (sql.startsWith("UPDATE rewards SET active=false")) { pending.snapshot.active = false; return { rows: [] }; }
      if (sql.startsWith("UPDATE rewards SET inventory_remaining=NULL")) {
        assert.equal(pending.snapshot.active, false, "must respect the published-details trigger");
        if (failReset) throw Object.assign(Error("unit storage failure"), { code: "XX000" });
        Object.assign(pending.snapshot, { inventory_remaining: null, fulfillment_reference: null, validated_at: null, validated_by: null }); return { rows: [] };
      }
      throw Error("unexpected_test_query");
    } };
  } };
}
test("explicit recovery preserves original state and identifier without publishing or creating stock", async () => {
  const pool = poolFor(), before = structuredClone(pool.state.snapshot);
  const result = await recoverRewardDraft(pool, "user_Admin", rewardId, "recovery_test_key");
  assert.deepEqual(result, { rewardId, replayed: false });
  assert.deepEqual(pool.state.audit[0].previous, before);
  assert.equal(pool.state.snapshot.id, before.id); assert.equal(pool.state.snapshot.title, before.title);
  assert.equal(pool.state.snapshot.cost, before.cost); assert.equal(pool.state.snapshot.active, false);
  assert.equal(pool.state.snapshot.inventory_remaining, null); assert.equal(pool.state.snapshot.validated_at, null);
  assert.ok(!pool.queries.some(sql => /DELETE|UPDATE users|INSERT INTO point_movements|UPDATE redemptions/.test(sql)));
});
test("revoked roles, real operational evidence and historical operations prevent recovery", async () => {
  for (const [config, code] of [[{ role: null }, "admin_required"], [{ role: "participant" }, "admin_required"], [{ role: "verifier" }, "admin_required"],
    [{ operational: true }, "reward_already_operational"], [{ used: true }, "reward_has_operations"]]) {
    const pool = poolFor(config), before = structuredClone(pool.state.snapshot);
    await assert.rejects(recoverRewardDraft(pool, "user_Admin", rewardId, "recovery_test_key"), { code });
    assert.deepEqual(pool.state.snapshot, before); assert.equal(pool.state.audit.length, 0); assert.equal(pool.queries.at(-1), "ROLLBACK");
  }
});
test("concurrent retries audit and recover only once, including another key after recovery", async () => {
  const pool = poolFor();
  const results = await Promise.all([1, 2, 3].map(() => recoverRewardDraft(pool, "user_Admin", rewardId, "recovery_same_key")));
  assert.equal(results.filter(row => !row.replayed).length, 1); assert.equal(pool.state.audit.length, 1);
  assert.equal((await recoverRewardDraft(pool, "user_Admin", rewardId, "recovery_new_key")).replayed, true);
  assert.equal(pool.state.audit.length, 1);
  await assert.rejects(recoverRewardDraft(pool, "user_Admin", "00000000-0000-4000-8000-000000000002", "recovery_same_key"), { code: "idempotency_key_reused" });
});
test("a failed reset rolls back both deactivation and audit snapshot", async () => {
  const pool = poolFor({ failReset: true }), before = structuredClone(pool.state.snapshot);
  await assert.rejects(recoverRewardDraft(pool, "user_Admin", rewardId, "recovery_fail_key"), { code: "XX000" });
  assert.deepEqual(pool.state.snapshot, before); assert.equal(pool.state.audit.length, 0);
});
test("editing a draft cannot rewrite a validated or previously redeemed reward", async () => {
  await assert.rejects(editRewardDraft({ async query(sql) {
    assert.match(sql, /validated_at IS NULL/); assert.match(sql, /NOT EXISTS \(SELECT 1 FROM redemptions/); return { rows: [] };
  } }, rewardId, { title: "Test", description: "Unit", cost: 20 }, { title: "Changed", description: "Unit", cost: 30 }), { code: "reward_changed_or_unavailable" });
});
