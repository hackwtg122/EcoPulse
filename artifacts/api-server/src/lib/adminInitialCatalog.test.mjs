import assert from "node:assert/strict";
import test from "node:test";
import { initializeAdminCatalog } from "./adminInitialCatalog.ts";

function makePool({ role = "admin", centers = 0, rewards = 0, failRewards = false } = {}) {
  const state = { centers, rewards, slots: 0, materials: 0, committed: 0, rolledBack: 0, activeValues: [] };
  const client = {
    async query(sql, values = []) {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      if (statement === "BEGIN") return { rows: [] };
      if (statement === "COMMIT") { state.committed++; return { rows: [] }; }
      if (statement === "ROLLBACK") { state.rolledBack++; return { rows: [] }; }
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (statement.startsWith("SELECT role FROM users")) return { rows: [{ role }] };
      if (statement.includes("count(*)::text AS count FROM delivery_points")) return { rows: [{ count: String(state.centers) }] };
      if (statement.includes("count(*)::text AS count FROM rewards")) return { rows: [{ count: String(state.rewards) }] };
      if (statement.startsWith("INSERT INTO delivery_points")) {
        assert.match(statement, /true,false\)/);
        state.centers++;
        state.activeValues.push(false);
        return { rows: [{ id: values[0] }] };
      }
      if (statement.startsWith("INSERT INTO delivery_point_materials")) { state.materials++; return { rows: [] }; }
      if (statement.startsWith("INSERT INTO delivery_slots")) {
        assert.match(statement, /\$5,false\)/);
        state.slots++;
        state.activeValues.push(false);
        return { rows: [] };
      }
      if (statement.startsWith("INSERT INTO rewards")) {
        if (failRewards) throw new Error("injected_reward_failure");
        assert.match(statement, /\$4,false\)/);
        state.rewards++;
        state.activeValues.push(false);
        return { rows: [{ id: values[0] }] };
      }
      throw new Error("Unexpected SQL " + statement);
    },
    release() {},
  };
  return { state, pool: { async connect() { return client; } } };
}

test("admin initializes editable centers, material lists, future slots and rewards without publishing", async () => {
  const { pool, state } = makePool();
  const result = await initializeAdminCatalog(pool, "user_admin", new Date("2026-11-05T12:00:00.000Z"));
  assert.deepEqual(result, { centersCreated: 2, slotsCreated: 2, rewardsCreated: 3, published: false });
  assert.equal(state.materials, 6);
  assert.equal(state.committed, 1);
  assert.equal(state.rolledBack, 0);
  assert.ok(state.activeValues.every(value => value === false));
});

test("initialization is idempotent and leaves preexisting rows untouched", async () => {
  const { pool, state } = makePool({ centers: 4, rewards: 2 });
  const once = await initializeAdminCatalog(pool, "user_admin");
  const twice = await initializeAdminCatalog(pool, "user_admin");
  assert.deepEqual(once, { centersCreated: 0, slotsCreated: 0, rewardsCreated: 0, published: false });
  assert.deepEqual(twice, once);
  assert.equal(state.centers, 4);
  assert.equal(state.rewards, 2);
  assert.equal(state.committed, 2);
});

test("initialization cannot run under participant role", async () => {
  const { pool, state } = makePool({ role: "participant" });
  await assert.rejects(initializeAdminCatalog(pool, "user_participant"), /admin_required/);
  assert.equal(state.committed, 0);
  assert.equal(state.rolledBack, 1);
  assert.equal(state.centers, 0);
});

test("initialization stops and rolls back on reward insertion failure", async () => {
  const { pool, state } = makePool({ failRewards: true });
  await assert.rejects(initializeAdminCatalog(pool, "user_admin"), /injected_reward_failure/);
  assert.equal(state.committed, 0);
  assert.equal(state.rolledBack, 1);
});
