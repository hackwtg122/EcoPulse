import { pathToFileURL } from "node:url";

// Remote runner, or explicit direct inspection of the remote Neon service via
// the agent's tool. This is not application/functional QA or a local database.
// No connection-string logging, user identifiers, data export,
// DDL, grants, inserts or maintenance operations.
if (process.env.GITHUB_ACTIONS !== "true" && !process.argv.includes("--direct-neon-inspection")) throw new Error("remote_runner_required");
if (!process.env.NEON_READONLY_URL) throw new Error("NEON_READONLY_URL_secret_required");
let connection;
try { connection = new URL(process.env.NEON_READONLY_URL); }
catch { throw new Error("invalid_neon_connection_configuration"); }
if (!["postgres:", "postgresql:"].includes(connection.protocol) ||
    !connection.hostname.endsWith(".neon.tech") || connection.pathname !== "/neondb" ||
    connection.searchParams.get("sslmode") !== "verify-full") {
  throw new Error("requires_Neon_neondb_with_sslmode_verify_full");
}
if (!process.env.PROD_QA_PG_MODULE) throw new Error("remote_pg_driver_required");
const { default: pg } = await import(pathToFileURL(process.env.PROD_QA_PG_MODULE).href);
const client = new pg.Client({ connectionString: connection.href, connectionTimeoutMillis: 15000, query_timeout: 20000 });
const emit = (check, data) => console.log(JSON.stringify({ check, data }));
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SET LOCAL lock_timeout = '3s'");
  const state = await client.query("SELECT current_database() AS database, current_user AS role, current_setting('transaction_read_only') AS read_only");
  if (state.rows[0]?.database !== "neondb" || state.rows[0]?.read_only !== "on") throw new Error("readonly_guard_failed");
  emit("connection", state.rows);
  emit("tables", (await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows);
  emit("columns", (await client.query(`SELECT table_name,column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows);
  emit("app_role_security", (await client.query(`SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls
    FROM pg_roles WHERE rolname IN (current_user,'ecopulse_app')`)).rows);
  emit("table_privileges", (await client.query(`SELECT grantee,table_name,privilege_type
    FROM information_schema.role_table_grants WHERE table_schema='public'
    AND grantee IN (current_user,'ecopulse_app','PUBLIC') ORDER BY grantee,table_name,privilege_type`)).rows);
  emit("column_privileges", (await client.query(`SELECT grantee,table_name,column_name,privilege_type
    FROM information_schema.column_privileges WHERE table_schema='public'
    AND grantee IN (current_user,'ecopulse_app','PUBLIC') ORDER BY grantee,table_name,column_name,privilege_type`)).rows);
  // Fixed allowlist only; absent tables are reported, not created or assumed.
  for (const table of ["users", "scans", "deliveries", "point_movements", "redemptions", "rewards", "verifications",
    "delivery_idempotency", "delivery_items", "delivery_points", "delivery_slots", "delivery_status_events",
    "material_categories", "favorite_centers", "delivery_point_materials", "role_change_events"]) {
    const exists = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
    if (!exists.rows[0]?.present) { emit("count", { table, status: "MISSING" }); continue; }
    emit("count", { table, ...(await client.query(`SELECT count(*)::text AS total FROM public."${table}"`)).rows[0] });
  }
  const users = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS present");
  if (users.rows[0]?.present) emit("user_role_counts", (await client.query("SELECT role,count(*)::text AS total FROM public.users GROUP BY role ORDER BY role")).rows);
  const journal = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present");
  emit("migration_journal_present", journal.rows[0]?.present);
  if (journal.rows[0]?.present) emit("migrations", (await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows);
  emit("result", "READ_ONLY_INVENTORY_COMPLETE_NOT_FUNCTIONAL_PASS");
} catch (error) {
  // Driver messages can include connection details or row contents. Never emit
  // raw errors. A denied SELECT remains blocked instead of changing grants.
  const code = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "query_or_connection_failed";
  emit("result", { status: "BLOCKED", code });
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}
