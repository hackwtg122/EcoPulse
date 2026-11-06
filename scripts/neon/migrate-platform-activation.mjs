import { readFile } from "node:fs/promises";
import pg from "pg";
const dryRun = process.argv.includes("--dry-run");
if (process.env.PLATFORM_ACTIVATION_MIGRATION_AUTHORIZED !== "true" || (!dryRun && !process.argv.includes("--apply"))) throw Error("explicit_migration_authorization_required");
const url = new URL(process.env.NEON_DATABASE_URL || "");
if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb") throw Error("existing_production_neon_required");
url.searchParams.set("sslmode", "verify-full");
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000 });
let stage = "connection";
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query("SET LOCAL statement_timeout='20s'");
  await client.query("SELECT pg_advisory_xact_lock(741926242)");
  const { rows: [state] } = await client.query(`SELECT to_regclass('public.reward_draft_recoveries') IS NOT NULL AS prerequisite,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ecopulse_app' AND NOT rolsuper AND NOT rolbypassrls) AS safe_role,
    to_regclass('public.platform_activation_events') IS NOT NULL AS present`);
  if (!state.prerequisite || !state.safe_role) throw Error("prerequisites_missing");
  stage = "additive_schema";
  if (!state.present) await client.query(await readFile(new URL("./platform-activation-migration.sql", import.meta.url), "utf8"));
  const { rows: [truncateGuard] } = await client.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.platform_activation_events'::regclass AND tgname='platform_activation_events_no_truncate') AS present");
  if (!truncateGuard.present) await client.query(`CREATE TRIGGER platform_activation_events_no_truncate BEFORE TRUNCATE ON public.platform_activation_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_platform_activation_mutation()`);
  stage = "permissions_and_queries";
  const { rows: [metadata] } = await client.query(`SELECT obj_description('public.platform_activation_events'::regclass,'pg_class') AS marker,
    has_table_privilege('ecopulse_app','public.platform_activation_events','SELECT') AND has_table_privilege('ecopulse_app','public.platform_activation_events','INSERT') AS allowed,
    has_table_privilege('ecopulse_app','public.platform_activation_events','UPDATE,DELETE,TRUNCATE') AS mutable,
    has_sequence_privilege('ecopulse_app','public.platform_activation_events_revision_seq','USAGE') AS sequence_ready,
    (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='public.platform_activation_events'::regclass AND tgname IN ('platform_activation_events_immutable','platform_activation_events_no_truncate') AND tgenabled='O') AS immutable`);
  if (metadata.marker !== "ecopulse:platform-activation:v1" || !metadata.allowed || metadata.mutable || !metadata.sequence_ready || !metadata.immutable) throw Error("schema_requires_review");
  await client.query("PREPARE activation_latest AS SELECT flags FROM platform_activation_events ORDER BY revision DESC LIMIT 1");
  await client.query("PREPARE activation_replay(text,text) AS SELECT result FROM platform_activation_events WHERE administrator_id=$1 AND idempotency_key=$2");
  await client.query("PREPARE activation_insert(uuid,text,text,jsonb,jsonb) AS INSERT INTO platform_activation_events(id,administrator_id,idempotency_key,flags,result) VALUES($1,$2,$3,$4,$5)");
  await client.query("PREPARE activation_actor(text) AS SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE");
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.log(JSON.stringify({ check: "platform_activation_migration", status: "PASS", dryRun, applied: !dryRun && !state.present, preparedQueries: 4, businessWrites: 0, activationEventsCreated: 0, accountsChanged: 0 }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "platform_activation_migration", status: "BLOCKED", stage, code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "migration_failed" }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
