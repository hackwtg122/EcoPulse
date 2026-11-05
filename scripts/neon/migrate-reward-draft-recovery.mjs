import { readFile } from "node:fs/promises";
import pg from "pg";
import { verifyRewardDraftRecovery } from "./verify-reward-draft-recovery.mjs";
const dryRun = process.argv.includes("--dry-run");
if (process.env.REWARD_DRAFT_RECOVERY_MIGRATION_AUTHORIZED !== "true" || (!dryRun && !process.argv.includes("--apply"))) throw Error("explicit_migration_authorization_required");
const url = new URL(process.env.NEON_DATABASE_URL || "");
if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb") throw Error("existing_production_neon_required");
url.searchParams.set("sslmode", "verify-full");
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000 });
let stage = "connection";
try {
  await client.connect(); await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'"); await client.query("SET LOCAL statement_timeout='20s'");
  await client.query("SELECT pg_advisory_xact_lock(741926240)");
  const { rows: [state] } = await client.query(`SELECT to_regclass('public.reward_inventory_movements') IS NOT NULL AS inventory,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ecopulse_app' AND NOT rolsuper AND NOT rolbypassrls) AS safe_role,
    to_regclass('public.reward_draft_recoveries') IS NOT NULL AS present`);
  if (!state.inventory || !state.safe_role) throw Error("prerequisites_missing");
  stage = "additive_schema";
  if (!state.present) await client.query(await readFile(new URL("./reward-draft-recovery-migration.sql", import.meta.url), "utf8"));
  const { rows: [metadata] } = await client.query(`SELECT obj_description('public.reward_draft_recoveries'::regclass,'pg_class') AS marker,
    has_table_privilege('ecopulse_app','public.reward_draft_recoveries','SELECT') AND has_table_privilege('ecopulse_app','public.reward_draft_recoveries','INSERT') AS allowed,
    has_table_privilege('ecopulse_app','public.reward_draft_recoveries','UPDATE,DELETE,TRUNCATE') AS mutable`);
  if (metadata.marker !== 'ecopulse:reward-draft-recovery:v1' || !metadata.allowed || metadata.mutable) throw Error("schema_requires_review");
  stage = "verify_sql";
  const verification = await verifyRewardDraftRecovery(client);
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.log(JSON.stringify({ check: "reward_draft_recovery_migration", status: "PASS", dryRun, applied: !dryRun && !state.present, ...verification, accountsChanged: 0 }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "reward_draft_recovery_migration", status: "BLOCKED", stage, code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "migration_failed" })); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
