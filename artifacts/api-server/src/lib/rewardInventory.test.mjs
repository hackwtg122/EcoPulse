import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseRewardRestock, restockReward, redeemReward } from "./rewardService.ts";

// Isolated unit-test state only. Never connects to PostgreSQL or creates actors.
const rewardId = "00000000-0000-4000-8000-000000000001";
const input = quantity => ({ quantity, evidenceReference: "https://example.org/inventory-evidence", availabilityConfirmed: true });
function poolFor({ initial = 10, role = "admin", documented = true, failUpdate = false } = {}) {
  const state = { inventory: initial, active: initial > 0, movements: [], redemptions: [], debits: [], balance: 20 };
  const queries = [], tails = new Map();
  async function lock(key) {
    const previous = tails.get(key) ?? Promise.resolve();
    let release; const current = new Promise(resolve => { release = resolve; });
    tails.set(key, current); await previous; return release;
  }
  return { state, queries, async connect() {
    const releases = []; let pending = null;
    function unlock() { for (const release of releases.splice(0)) release(); }
    return { release: unlock, async query(raw, params = []) {
      const sql = raw.trim(); queries.push(sql);
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "ROLLBACK") { pending = null; unlock(); return { rows: [] }; }
      if (sql === "COMMIT") {
        if (pending) { state.inventory = pending.inventory; state.active = pending.active; state.balance = pending.balance;
          state.movements.push(...pending.movements); state.redemptions.push(...pending.redemptions); state.debits.push(...pending.debits); }
        unlock(); return { rows: [] };
      }
      if (sql.startsWith("SELECT role")) return { rows: role ? [{ role }] : [] };
      if (sql.startsWith("SELECT pg_advisory")) { releases.push(await lock(`key:${params[0]}`)); return { rows: [] }; }
      if (sql.includes("FROM reward_inventory_movements WHERE administrator_id")) return { rows: state.movements.filter(row => row.administratorId === params[0] && row.key === params[1]) };
      if ((sql.startsWith("SELECT active,inventory_remaining") || sql.startsWith("SELECT cost,inventory_remaining")) && sql.includes("FOR UPDATE")) {
        releases.push(await lock("reward"));
        pending = { inventory: state.inventory, active: state.active, balance: state.balance, movements: [], redemptions: [], debits: [] };
        return { rows: [{ active: state.active, inventory_remaining: state.inventory, cost: 20,
          fulfillment_reference: documented ? "https://example.org/fulfillment-evidence" : null, validated_at: documented ? new Date() : null, validated_by: documented ? "user_Admin" : null }] };
      }
      if (sql.startsWith("INSERT INTO reward_inventory_movements")) {
        const [id, rewardId, administratorId, key, quantity, inventoryBefore, inventoryAfter, evidenceReference] = params;
        const row = { id, rewardId, administratorId, key, quantity, inventoryBefore, inventoryAfter, evidenceReference, createdAt: new Date() };
        pending.movements.push(row); return { rows: [row] };
      }
      if (sql.startsWith("UPDATE rewards SET inventory_remaining=inventory_remaining+$2")) {
        if (failUpdate) throw Object.assign(Error("test_write_failure"), { code: "XX000" });
        pending.inventory += params[1]; pending.active = true; return { rows: [{ id: params[0] }] };
      }
      if (sql.startsWith("SELECT clerk_user_id")) return { rows: [{ clerk_user_id: params[0] }] };
      if (sql.startsWith("SELECT id,reward_id")) return { rows: [] };
      if (sql.startsWith("SELECT to_regclass('public.reward_photos')") || sql.startsWith("SELECT EXISTS(SELECT 1 FROM public.reward_photos")) return { rows: [{ present: true }] };
      if (sql.startsWith("SELECT coalesce(sum(delta)")) return { rows: [{ balance: String(pending.balance) }] };
      if (sql.startsWith("INSERT INTO redemptions")) { const row = { id: params[0], reward_id: params[2], cost: params[3], fulfillment_status: "reserved" }; pending.redemptions.push(row); return { rows: [row] }; }
      if (sql.startsWith("INSERT INTO point_movements")) { pending.balance += params[2]; pending.debits.push(params[2]); return { rows: [] }; }
      if (sql.startsWith("UPDATE rewards SET inventory_remaining=inventory_remaining-1")) { pending.inventory--; pending.active = pending.inventory > 0; return { rows: [] }; }
      throw Error(`unexpected_test_query:${sql}`);
    } };
  } };
}

test("restock accepts only positive quantities, authorized availability and public HTTPS evidence", () => {
  assert.deepEqual(parseRewardRestock(input(3)), input(3));
  for (const body of [input(0), input(-1), input(1.5), input(100001), { ...input(1), availabilityConfirmed: false },
    { ...input(1), administratorId: "forbidden" }, { ...input(1), evidenceReference: "http://example.org/stock" },
    { ...input(1), evidenceReference: "https://user:secret@example.org/stock" }, { ...input(1), evidenceReference: "https://127.0.0.1/stock" },
    { ...input(1), evidenceReference: "https://example.org/stock#fragment" }]) assert.throws(() => parseRewardRestock(body), { status: 400 });
});
test("missing, participant and verifier roles cannot add inventory or audit records", async () => {
  for (const role of [null, "participant", "verifier"]) {
    const pool = poolFor({ role });
    await assert.rejects(restockReward(pool, "user_Admin", rewardId, "restock_key_01", input(3)), { status: 403, code: "admin_required" });
    assert.equal(pool.state.inventory, 10); assert.equal(pool.state.movements.length, 0);
    assert.equal(pool.queries.at(-1), "ROLLBACK");
  }
});
test("concurrent retries of one key add inventory only once", async () => {
  const pool = poolFor();
  const results = await Promise.all([1, 2, 3].map(() => restockReward(pool, "user_Admin", rewardId, "same_restock_key", input(3))));
  assert.equal(pool.state.inventory, 13); assert.equal(pool.state.movements.length, 1);
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.deepEqual(pool.state.redemptions, []); assert.deepEqual(pool.state.debits, []);
});
test("different concurrent restocks serialize and retain accurate before/after audit values", async () => {
  const pool = poolFor();
  await Promise.all([restockReward(pool, "user_Admin", rewardId, "restock_first_key", input(3)), restockReward(pool, "user_Admin", rewardId, "restock_second_key", input(4))]);
  assert.equal(pool.state.inventory, 17); assert.equal(pool.state.movements.length, 2);
  assert.equal(pool.state.movements[0].inventoryBefore, 10);
  assert.equal(pool.state.movements[1].inventoryBefore, pool.state.movements[0].inventoryAfter);
  assert.equal(pool.state.movements[1].inventoryAfter, 17);
});
test("restock concurrent with redemption never loses a stock debit or charges extra points", async () => {
  for (const restockFirst of [false, true]) {
    const pool = poolFor({ initial: 1 });
    const add = () => restockReward(pool, "user_Admin", rewardId, "restock_concurrent", input(4));
    const spend = () => redeemReward(pool, "user_Owner", rewardId, "redeem_concurrent");
    await Promise.all(restockFirst ? [add(), spend()] : [spend(), add()]);
    assert.equal(pool.state.inventory, 4); assert.equal(pool.state.balance, 0);
    assert.equal(pool.state.movements.length, 1); assert.equal(pool.state.redemptions.length, 1);
    assert.deepEqual(pool.state.debits, [-20]);
  }
});
test("changed payload/key conflicts, missing evidence and inventory bounds never mutate stock", async () => {
  const pool = poolFor(); await restockReward(pool, "user_Admin", rewardId, "restock_key_01", input(3));
  await assert.rejects(restockReward(pool, "user_Admin", rewardId, "restock_key_01", input(4)), { code: "idempotency_key_reused" });
  await assert.rejects(restockReward(pool, "user_Admin", "00000000-0000-4000-8000-000000000002", "restock_key_01", input(3)), { code: "idempotency_key_reused" });
  await assert.rejects(restockReward(pool, "user_Admin", rewardId, "restock_key_01", { ...input(3), evidenceReference: "https://example.org/other-evidence" }), { code: "idempotency_key_reused" });
  assert.equal(pool.state.inventory, 13); assert.equal(pool.state.movements.length, 1);
  for (const [config, code] of [[{ initial: 99999 }, "reward_inventory_limit_exceeded"], [{ documented: false }, "reward_not_restockable"]]) {
    const blocked = poolFor(config);
    const initial = blocked.state.inventory;
    await assert.rejects(restockReward(blocked, "user_Admin", rewardId, "restock_key_02", input(3)), { code });
    assert.equal(blocked.state.movements.length, 0);
    assert.equal(blocked.state.inventory, initial);
  }
});
test("replenishment leaves existing redemptions, debits and fulfillment evidence untouched", async () => {
  const pool = poolFor();
  pool.state.redemptions.push({ id: "historical-unit-record", fulfillment_status: "fulfilled", reference: "UNIT-RECEIPT-001", cost: 20 });
  pool.state.debits.push(-20);
  const history = structuredClone({ redemptions: pool.state.redemptions, debits: pool.state.debits, balance: pool.state.balance });
  await restockReward(pool, "user_Admin", rewardId, "restock_history_key", input(2));
  assert.deepEqual({ redemptions: pool.state.redemptions, debits: pool.state.debits, balance: pool.state.balance }, history);
  assert.ok(!pool.queries.some(sql => /UPDATE redemptions|INSERT INTO point_movements/.test(sql)));
});
test("failed inventory update rolls back its audit entry; exhausted rewards can be restocked", async () => {
  const failed = poolFor({ failUpdate: true });
  await assert.rejects(restockReward(failed, "user_Admin", rewardId, "restock_failed_key", input(3)), { code: "XX000" });
  assert.equal(failed.state.inventory, 10); assert.equal(failed.state.movements.length, 0); assert.equal(failed.queries.at(-1), "ROLLBACK");
  const exhausted = poolFor({ initial: 0 }); await restockReward(exhausted, "user_Admin", rewardId, "restock_empty_key", input(2));
  assert.equal(exhausted.state.inventory, 2); assert.equal(exhausted.state.active, true);
});
test("inventory migration is additive, append-only and has per-administrator idempotency", async () => {
  const sql = await readFile(new URL("../../../../scripts/neon/reward-inventory-migration.sql", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE \(administrator_id, idempotency_key\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /inventory_after = inventory_before \+ quantity/);
  assert.match(sql, /GRANT SELECT, INSERT/);
  assert.ok(!/INSERT INTO|UPDATE public\.rewards|DELETE FROM|TRUNCATE|BYPASSRLS/.test(sql));
});
