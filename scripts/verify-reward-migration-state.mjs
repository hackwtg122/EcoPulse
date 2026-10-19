import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
assert.ok(existsSync(envFile), ".env.local missing");
process.loadEnvFile(envFile);
const stage = process.argv[2];
assert.ok(stage === "before" || stage === "migrated" || stage === "after", "expected before or after");
for (const [name, user] of [["DATABASE_URL", "ecopulse_app"], ["MIGRATION_DATABASE_URL", "ecopulse_migrator"]]) {
  const url = new URL(process.env[name]);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/ecopulse_dev");
  assert.equal(decodeURIComponent(url.username), user);
  assert.ok(url.password);
}
const pool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const baselineFile = path.join(root, "backups", "0003-preflight-state.json");
try {
  const applied = await pool.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at,id");
  const expectedTags = ["0000_core", "0001_delivery_details", "0002_catalog_validation", "0003_reward_fulfillment"];
  const expectedHashes = expectedTags.map(tag => createHash("sha256")
    .update(readFileSync(path.join(root, "lib", "db", "drizzle", tag + ".sql"))).digest("hex"));
  assert.equal(applied.rowCount, stage === "before" ? 3 : 4);
  assert.deepEqual(applied.rows.map(row => row.hash), expectedHashes.slice(0, applied.rowCount));
  const stateResult = await pool.query(`
    SELECT (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM scans) AS scans,
      (SELECT count(*)::int FROM scans WHERE category='paper' AND source='manual') AS manual_paper_scans,
      (SELECT count(*)::int FROM deliveries) AS deliveries,
      (SELECT count(*)::int FROM deliveries WHERE id='ece719a5-739e-5626-a6b8-727b5dca04ce' AND status='pending' AND request_version=1) AS preserved_pending_delivery,
      (SELECT count(*)::int FROM delivery_points) AS centers,
      (SELECT count(*)::int FROM delivery_points WHERE active) AS active_centers,
      (SELECT count(*)::int FROM rewards) AS rewards,
      (SELECT count(*)::int FROM redemptions) AS redemptions,
      (SELECT count(*)::int FROM verifications) AS verifications,
      (SELECT count(*)::int FROM point_movements) AS point_movements`);
  const state = stateResult.rows[0];
  const columns = await pool.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='rewards' AND column_name='inventory_remaining'");
  const trigger = await pool.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='rewards_protect_published_details' AND NOT tgisinternal");
  const roleSql = stage === "before"
    ? `SELECT has_schema_privilege('ecopulse_app','public','CREATE') AS schema_create,
        has_column_privilege('ecopulse_app','public.rewards','title','INSERT') AS draft_insert,
        false AS inventory_update, false AS fulfillment_update`
    : `SELECT has_schema_privilege('ecopulse_app','public','CREATE') AS schema_create,
        has_column_privilege('ecopulse_app','public.rewards','title','INSERT') AS draft_insert,
        has_column_privilege('ecopulse_app','public.rewards','inventory_remaining','UPDATE') AS inventory_update,
        has_column_privilege('ecopulse_app','public.redemptions','fulfillment_status','UPDATE') AS fulfillment_update`;
  const role = await pool.query(roleSql);
  assert.equal(role.rows[0].schema_create, false);
  if (stage === "before") {
    assert.equal(columns.rows[0].count, 0);
    assert.equal(trigger.rows[0].count, 0);
    assert.equal(role.rows[0].inventory_update, false);
    assert.equal(role.rows[0].fulfillment_update, false);
    assert.deepEqual(state, {
      users: 3, scans: 1, manual_paper_scans: 1, deliveries: 1, preserved_pending_delivery: 1,
      centers: 2, active_centers: 0, rewards: 0, redemptions: 0, verifications: 0, point_movements: 0
    });
    writeFileSync(baselineFile, JSON.stringify(state) + "\n", { flag: "wx" });
  } else {
    assert.ok(existsSync(baselineFile), "preflight state missing");
    assert.deepEqual(state, JSON.parse(readFileSync(baselineFile, "utf8")));
    assert.equal(columns.rows[0].count, 1);
    assert.equal(trigger.rows[0].count, 1);
    assert.equal(role.rows[0].draft_insert, stage === "after");
    assert.equal(role.rows[0].inventory_update, false);
    assert.equal(role.rows[0].fulfillment_update, false);
  }
  console.log(JSON.stringify({ stage, migrationCount: applied.rowCount, migrationHashesMatch: true,
    preservedState: state, rewardColumn: columns.rows[0].count === 1,
    guardTrigger: trigger.rows[0].count === 1,
    appDraftInsert: role.rows[0].draft_insert, appInventoryUpdate: role.rows[0].inventory_update,
    appFulfillmentUpdate: role.rows[0].fulfillment_update, credentialsPrinted: false }));
} finally {
  await pool.end();
}