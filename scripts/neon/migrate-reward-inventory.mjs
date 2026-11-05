import { readFile } from "node:fs/promises";
import pg from "pg";
import { verifyRewardInventory } from "./verify-reward-inventory.mjs";

const dryRun = process.argv.includes("--dry-run");
if (process.env.REWARD_INVENTORY_MIGRATION_AUTHORIZED !== "true" || (!dryRun && !process.argv.includes("--apply")))
  throw new Error("explicit_inventory_migration_authorization_required");
const url = new URL(process.env.NEON_DATABASE_URL || "");
if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb" || !["postgres:", "postgresql:"].includes(url.protocol))
  throw new Error("existing_production_neon_required");
url.searchParams.set("sslmode", "verify-full");
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000 });
let stage = "connection";
try {
  await client.connect(); await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'"); await client.query("SET LOCAL statement_timeout='20s'");
  await client.query("SELECT pg_advisory_xact_lock(741926239)");
  stage = "prerequisites";
  const { rows: [state] } = await client.query(`SELECT to_regclass('public.rewards') IS NOT NULL AS rewards,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rewards' AND column_name='inventory_remaining') AS inventory,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ecopulse_app' AND NOT rolsuper AND NOT rolbypassrls) AS safe_role,
    to_regclass('public.reward_inventory_movements') IS NOT NULL AS ledger`);
  if (!state.rewards || !state.inventory || !state.safe_role) throw Error("prerequisites_missing");
  if (state.ledger) {
    const { rows: [marked] } = await client.query("SELECT obj_description('public.reward_inventory_movements'::regclass,'pg_class') AS marker");
    if (marked.marker !== "ecopulse:reward-inventory:v1") throw Error("existing_table_requires_review");
  } else {
    stage = "additive_ddl";
    await client.query(await readFile(new URL("./reward-inventory-migration.sql", import.meta.url), "utf8"));
  }
  stage = "permissions";
  const { rows: [rights] } = await client.query(`SELECT
    has_table_privilege('ecopulse_app','public.reward_inventory_movements','SELECT,INSERT') AS allowed,
    has_table_privilege('ecopulse_app','public.reward_inventory_movements','UPDATE,DELETE,TRUNCATE') AS mutable,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.reward_inventory_movements'::regclass AND tgname='reward_inventory_immutable' AND tgenabled='O') AS immutable`);
  // has_table_privilege's comma list means ANY, so check read and insert separately.
  const { rows: [insert] } = await client.query("SELECT has_table_privilege('ecopulse_app','public.reward_inventory_movements','INSERT') AND has_table_privilege('ecopulse_app','public.reward_inventory_movements','SELECT') AS ready");
  if (!rights.allowed || rights.mutable || !rights.immutable || !insert.ready) throw Error("runtime_permissions_invalid");
  stage = "schema_verification";
  const verification = await verifyRewardInventory(client);
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.log(JSON.stringify({ check: "reward_inventory_migration", status: "PASS", dryRun, applied: !dryRun && !state.ledger, ...verification }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "reward_inventory_migration", status: "BLOCKED", stage, code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "migration_failed" }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
