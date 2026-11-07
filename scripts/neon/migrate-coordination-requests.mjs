import { readFile } from "node:fs/promises";
import pg from "pg";

const dryRun = process.argv.includes("--dry-run");
if (process.env.COORDINATION_REQUESTS_MIGRATION_AUTHORIZED !== "true" || (!dryRun && !process.argv.includes("--apply"))) {
  throw Error("explicit_migration_authorization_required");
}
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
  await client.query("SELECT pg_advisory_xact_lock(741926243)");
  const { rows: [state] } = await client.query(`SELECT to_regclass('public.deliveries') IS NOT NULL AS prerequisite,
    to_regclass('public.material_categories') IS NOT NULL AS categories,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ecopulse_app' AND NOT rolsuper AND NOT rolbypassrls) AS safe_role,
    to_regclass('public.coordination_requests') IS NOT NULL AS present`);
  if (!state.prerequisite || !state.categories || !state.safe_role) throw Error("prerequisites_missing");
  stage = "additive_schema";
  if (!state.present) await client.query(await readFile(new URL("./coordination-requests-migration.sql", import.meta.url), "utf8"));
  stage = "permissions";
  await client.query(await readFile(new URL("./coordination-requests-grants.sql", import.meta.url), "utf8"));
  stage = "verify_sql";
  const { rows: [metadata] } = await client.query(`SELECT
    obj_description('public.coordination_requests'::regclass,'pg_class') AS marker,
    (SELECT count(*)=3 FROM pg_class WHERE oid IN ('public.coordination_requests'::regclass,'public.coordination_request_items'::regclass,'public.coordination_request_events'::regclass)
      AND obj_description(oid,'pg_class')='ecopulse:coordination-requests:v1') AS markers,
    has_table_privilege('ecopulse_app','public.coordination_requests','SELECT,INSERT')
      AND has_table_privilege('ecopulse_app','public.coordination_request_items','SELECT,INSERT')
      AND has_table_privilege('ecopulse_app','public.coordination_request_events','SELECT,INSERT') AS readable,
    has_column_privilege('ecopulse_app','public.coordination_requests','status','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','delivery_id','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','assigned_point_id','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','assigned_by','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','assigned_at','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','updated_at','UPDATE') AS assignable,
    has_table_privilege('ecopulse_app','public.coordination_requests','DELETE,TRUNCATE')
      OR has_table_privilege('ecopulse_app','public.coordination_request_items','DELETE,TRUNCATE')
      OR has_table_privilege('ecopulse_app','public.coordination_request_events','DELETE,TRUNCATE') AS mutable`);
  if (metadata.marker !== "ecopulse:coordination-requests:v1" || !metadata.markers || !metadata.readable || !metadata.assignable || metadata.mutable) {
    throw Error("schema_requires_review");
  }
  await client.query(`PREPARE coordination_own(text) AS
    SELECT r.id, r.status, r.created_at, i.category_code, i.estimated_grams
    FROM public.coordination_requests r LEFT JOIN public.coordination_request_items i ON i.request_id = r.id
    WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 50`);
  await client.query(`PREPARE coordination_events(uuid) AS
    SELECT id, to_status, created_at FROM public.coordination_request_events WHERE request_id = $1 ORDER BY created_at, id`);
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.log(JSON.stringify({ check: "coordination_requests_migration", status: "PASS", dryRun, applied: !dryRun && !state.present, preparedQueries: 2, businessWrites: 0, coordinationRequestsCreated: 0, accountsChanged: 0 }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "coordination_requests_migration", status: "BLOCKED", stage, code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "migration_failed" }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
