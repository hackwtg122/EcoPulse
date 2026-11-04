import { readFile } from "node:fs/promises";
import pg from "pg";

// Explicitly authorized, additive migration of the existing production Neon DB.
// Never use DATABASE_URL (which may point to a local developer database).
const dryRun = process.argv.includes("--dry-run");
if (
  process.env.GUIDE_MIGRATION_AUTHORIZED !== "true" ||
  (!dryRun && !process.argv.includes("--apply"))
)
  throw new Error("explicit_guide_migration_authorization_required");
const url = new URL(process.env.NEON_DATABASE_URL || "");
if (
  !url.hostname.endsWith(".neon.tech") ||
  url.pathname !== "/neondb" ||
  !["postgres:", "postgresql:"].includes(url.protocol)
)
  throw new Error("existing_production_neon_required");
url.searchParams.set("sslmode", "verify-full");
const client = new pg.Client({
  connectionString: url.href,
  connectionTimeoutMillis: 15000,
});
let stage = "connection";
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query("SET LOCAL statement_timeout='20s'");
  await client.query("SELECT pg_advisory_xact_lock(741926238)");
  stage = "prerequisites";
  const state =
    await client.query(`SELECT to_regclass('public.guide_conversations') IS NOT NULL AS conversations,
    to_regclass('public.guide_turns') IS NOT NULL AS turns,
    to_regclass('public.users') IS NOT NULL AS users,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ecopulse_app' AND NOT rolsuper AND NOT rolbypassrls) AS safe_role`);
  const row = state.rows[0];
  if (!row.users || !row.safe_role)
    throw new Error("existing_prerequisites_unavailable");
  if (row.conversations || row.turns) {
    const marked =
      await client.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('guide_conversations','guide_turns')
      AND obj_description(c.oid,'pg_class')='ecopulse:ecoguide-persistence:v1' AND c.relrowsecurity AND c.relforcerowsecurity`);
    if (!row.conversations || !row.turns || marked.rows[0].count !== 2)
      throw new Error("existing_tables_require_manual_review");
  } else {
    stage = "additive_ddl";
    await client.query(
      await readFile(
        new URL("./ecoguide-persistence-migration.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  // Inspect the existing runtime role's privileges; never grant membership or
  // impersonate it to make a test pass. Neon may forbid SET ROLE for the owner.
  stage = "runtime_policy_verification";
  for (const table of ["guide_conversations", "guide_turns"]) {
    const policy = await client.query(
      `SELECT c.relrowsecurity AND c.relforcerowsecurity AS protected,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS policies
      FROM pg_class c WHERE c.oid=to_regclass($1)`,
      [`public.${table}`],
    );
    if (!policy.rows[0]?.protected || policy.rows[0].policies !== 1)
      throw new Error("runtime_rls_policy_unavailable");
    const rights = await client.query(
      "SELECT bool_and(has_table_privilege('ecopulse_app',$1,privilege)) AS ready FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege",
      [`public.${table}`],
    );
    if (!rights.rows[0].ready)
      throw new Error("runtime_permissions_unavailable");
  }
  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  console.log(
    JSON.stringify({
      check: "ecoguide_migration",
      status: "PASS",
      dryRun,
      applied: !dryRun && !row.conversations,
      rlsPoliciesVerified: true,
      runtimeSessionTested: false,
      operationalRecordsCreated: 0,
      scope: "schema_not_authenticated_flow",
    }),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  const reasons = new Set([
    "existing_prerequisites_unavailable",
    "existing_tables_require_manual_review",
    "runtime_rls_policy_unavailable",
    "runtime_permissions_unavailable",
  ]);
  console.log(
    JSON.stringify({
      check: "ecoguide_migration",
      status: "BLOCKED",
      stage,
      reason: reasons.has(error.message)
        ? error.message
        : "migration_or_connection_failed",
      code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
