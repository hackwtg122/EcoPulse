import assert from "node:assert/strict";
import test from "node:test";
import { activatePlatform, mergePlatformEnvironment, platformModules, readPlatformEnvironment } from "./platformActivation.ts";

const complete = { catalog: true, materials: true, rewards: true, destinations: true, availableRewards: true, pointsPolicy: true, rewardPolicy: true };
test("complete resources are eligible, but readiness alone does not activate switches", () => {
  const modules = platformModules(complete, {});
  assert.equal(modules.length, 6);
  assert.ok(modules.every(module => module.ready && !module.enabled));
});
test("activation reports missing physical availability without inventing it", () => {
  const modules = platformModules({ ...complete, destinations: false, availableRewards: false }, {});
  for (const key of ["deliveries", "redemptions"]) {
    const module = modules.find(module => module.key === key);
    assert.equal(module.ready, false);
    assert.equal(module.missing.length, 1);
  }
  assert.equal(modules.find(module => module.key === "catalog").ready, true);
});
test("missing policy blocks value creation and redemption even with resources", () => {
  const modules = platformModules({ ...complete, pointsPolicy: false, rewardPolicy: false }, {});
  for (const key of ["points", "rewards", "redemptions"]) assert.equal(modules.find(module => module.key === key).ready, false);
});
test("stored activation can only enable explicitly allowlisted operational flags", () => {
  const base = { SECRET: "private", PILOT_POINTS_ENABLED: "false", POINTS_PER_KG: "20" };
  const merged = mergePlatformEnvironment(base, { SECRET: "replaced", POINTS_PER_KG: "9999", PILOT_POINTS_ENABLED: true, PILOT_RECEIPT_ENABLED: "true" });
  assert.equal(merged.SECRET, "private");
  assert.equal(merged.POINTS_PER_KG, "20");
  assert.equal(merged.PILOT_POINTS_ENABLED, "true");
  assert.equal(merged.PILOT_RECEIPT_ENABLED, undefined);
  assert.equal(base.PILOT_POINTS_ENABLED, "false");
});

function mockPool({ role = "admin", schema = true, prior = null, failInsert = false } = {}) {
  const queries = [];
  let released = false;
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, " ").trim();
    queries.push({ sql, params });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SET LOCAL") || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.startsWith("SELECT role FROM users")) return { rows: [{ role }] };
    if (sql.includes("c.relname='platform_activation_events'")) return { rows: [{ ready: schema }] };
    if (sql.startsWith("SELECT result FROM platform_activation_events")) return { rows: prior ? [{ result: prior }] : [] };
    if (sql.startsWith("SELECT flags FROM platform_activation_events")) return { rows: [] };
    // No configured operational schema in this fixture. Activation must only
    // write its own audit event and leave every operational switch untouched.
    if (sql.startsWith("SELECT")) return { rows: [{ ready: false }] };
    if (sql.startsWith("INSERT INTO platform_activation_events")) {
      if (failInsert) throw Error("injected_failure");
      return { rows: [] };
    }
    throw Error("Unexpected SQL " + sql);
  };
  return { pool: { query, async connect() { return { query, release() { released = true; } }; } }, queries, released: () => released };
}
test("runtime reads persisted activation without caching or exposing credentials", async () => {
  let reads = 0;
  const pool = { async query(sql) {
    if (sql.includes("pg_class")) return { rows: [{ ready: true }] };
    reads++;
    return { rows: [{ flags: { PILOT_POINTS_ENABLED: reads === 2 } }] };
  } };
  assert.equal((await readPlatformEnvironment(pool, {})).PILOT_POINTS_ENABLED, undefined);
  assert.equal((await readPlatformEnvironment(pool, {})).PILOT_POINTS_ENABLED, "true");
});
test("revoked administrator is rejected inside the transaction before any activation", async () => {
  const { pool, queries, released } = mockPool({ role: "participant" });
  await assert.rejects(activatePlatform(pool, "owner", "activation_123", {}), { status: 403, code: "admin_required" });
  assert.equal(queries.at(-1).sql, "ROLLBACK");
  assert.ok(!queries.some(query => query.sql.startsWith("INSERT")));
  assert.ok(released());
});
test("activation serializes requests and records only eligible switches, never business activity", async () => {
  const { pool, queries, released } = mockPool();
  const result = await activatePlatform(pool, "owner", "activation_123", {});
  assert.ok(result.modules.every(module => !module.ready && !module.enabled));
  const writes = queries.filter(query => /^(INSERT|UPDATE|DELETE)/.test(query.sql));
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /^INSERT INTO platform_activation_events/);
  assert.deepEqual(JSON.parse(writes[0].params[3]), {});
  assert.ok(queries.findIndex(query => query.sql.includes("pg_advisory_xact_lock")) < queries.findIndex(query => query.sql.startsWith("SELECT result")));
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.ok(released());
});
test("a retry replays the durable result before evaluating new resources", async () => {
  const { pool, queries } = mockPool({ prior: { modules: [], replayed: false } });
  assert.deepEqual(await activatePlatform(pool, "owner", "activation_123", {}), { modules: [], replayed: true });
  assert.ok(!queries.some(query => query.sql.startsWith("INSERT")));
  assert.ok(!queries.some(query => query.sql.startsWith("SELECT flags")));
});
test("failed persistence rolls back without reporting successful activation", async () => {
  const { pool, queries, released } = mockPool({ failInsert: true });
  await assert.rejects(activatePlatform(pool, "owner", "activation_123", {}), /injected_failure/);
  assert.equal(queries.at(-1).sql, "ROLLBACK");
  assert.ok(!queries.some(query => query.sql === "COMMIT"));
  assert.ok(released());
});
test("invalid intent and missing schema cannot activate anything", async () => {
  const { pool, queries } = mockPool({ schema: false });
  await assert.rejects(activatePlatform(pool, "owner", "bad", {}), { status: 400 });
  assert.equal(queries.length, 0);
  await assert.rejects(activatePlatform(pool, "owner", "activation_123", {}), { status: 503 });
  assert.ok(!queries.some(query => query.sql === "BEGIN"));
});
