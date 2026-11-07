import pg from "pg";

// Read-only structural verification for the coordination request tables.
// Never writes, never prints connection details or row contents.
if (!process.argv.includes("--direct-neon-inspection")) throw Error("explicit_read_only_inspection_required");
const raw = process.env.NEON_DATABASE_URL || "";
const url = new URL(raw);
if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb") throw Error("requires_Neon_neondb");
url.searchParams.set("sslmode", "verify-full");
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL default_transaction_read_only='on'");
  const { rows: [state] } = await client.query(`SELECT
    to_regclass('public.coordination_requests') IS NOT NULL AS present,
    (SELECT count(*)::int FROM pg_class WHERE oid IN ('public.coordination_requests'::regclass,'public.coordination_request_items'::regclass,'public.coordination_request_events'::regclass)
      AND obj_description(oid,'pg_class')='ecopulse:coordination-requests:v1') AS marked_tables,
    (SELECT count(*)::int FROM coordination_requests) AS request_rows,
    has_table_privilege('ecopulse_app','public.coordination_requests','SELECT,INSERT')
      AND has_table_privilege('ecopulse_app','public.coordination_request_items','SELECT,INSERT')
      AND has_table_privilege('ecopulse_app','public.coordination_request_events','SELECT,INSERT') AS app_read_write,
    has_column_privilege('ecopulse_app','public.coordination_requests','status','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','delivery_id','UPDATE')
      AND has_column_privilege('ecopulse_app','public.coordination_requests','assigned_point_id','UPDATE') AS app_assign,
    has_table_privilege('ecopulse_app','public.coordination_requests','DELETE,TRUNCATE') AS app_delete`);
  await client.query("ROLLBACK");
  const ok = state.present && state.marked_tables === 3 && state.app_read_write && state.app_assign && !state.app_delete;
  console.log(JSON.stringify({ check: "coordination_requests_structure", status: ok ? "PASS" : "BLOCKED", present: state.present, markedTables: state.marked_tables, requestRows: state.request_rows, appReadWrite: state.app_read_write, appAssign: state.app_assign, appDelete: state.app_delete }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "coordination_requests_structure", status: "BLOCKED", code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "inspection_failed" }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
