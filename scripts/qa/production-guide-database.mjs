import { pathToFileURL } from "node:url";
import { resolveGuideDatabaseUrl } from "../../lib/db/src/connectionConfig.ts";
import { renderGuideEnvironment } from "./render-guide-environment.mjs";

// Check the database actually selected by the existing Render API, not an
// assumed local URL. No Clerk impersonation, conversation writes or row export.
let client;
const fail = (reason) => {
  throw new Error(reason);
};
const safeReasons = new Set([
  "official_runner_required",
  "render_access_missing",
  "render_read_failed",
  "official_service_not_unique",
  "runtime_configuration_invalid",
  "runtime_database_requires_review",
  "guide_schema_missing",
  "runtime_role_bypasses_rls",
  "runtime_permissions_missing",
  "anonymous_database_principal_not_empty",
  "runtime_rls_failed",
]);
try {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "hackwtg122/EcoPulse" ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    fail("official_runner_required");
  if (!process.env.RENDER_API_KEY || !process.env.PROD_QA_PG_MODULE)
    fail("render_access_missing");
  const { env } = await renderGuideEnvironment();
  let url;
  try {
    url = new URL(resolveGuideDatabaseUrl(env));
  } catch {
    fail("runtime_configuration_invalid");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.pathname !== "/neondb"
  )
    fail("runtime_database_requires_review");
  url.searchParams.set("sslmode", "verify-full");
  const { default: pg } = await import(
    pathToFileURL(process.env.PROD_QA_PG_MODULE).href
  );
  client = new pg.Client({
    connectionString: url.href,
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout='15s'");
  const role = (
    await client.query(
      "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,current_setting('app.guide_user_id',true) AS principal FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolcreatedb ||
    role.rolcreaterole
  )
    fail("runtime_role_bypasses_rls");
  if (role.principal) fail("anonymous_database_principal_not_empty");
  for (const table of ["guide_conversations", "guide_turns"]) {
    if (
      !(
        await client.query("SELECT to_regclass($1) IS NOT NULL AS ready", [
          `public.${table}`,
        ])
      ).rows[0].ready
    )
      fail("guide_schema_missing");
    if (
      !(
        await client.query(
          "SELECT bool_and(has_table_privilege(current_user,$1,privilege)) AS ready FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege",
          [`public.${table}`],
        )
      ).rows[0].ready
    )
      fail("runtime_permissions_missing");
    if (
      !(
        await client.query(
          "SELECT row_security_active($1::regclass) AS active",
          [`public.${table}`],
        )
      ).rows[0].active
    )
      fail("runtime_rls_failed");
    if (
      (await client.query(`SELECT count(*)::int AS count FROM public.${table}`))
        .rows[0].count !== 0
    )
      fail("runtime_rls_failed");
  }
  console.log(
    JSON.stringify({
      check: "actual_render_guide_database",
      status: "PASS",
      existingNeonDatabase: true,
      rlsActive: true,
      noPrincipalRowsVisible: 0,
      conversationWrites: 0,
      scope: "runtime_database_not_Clerk_session",
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      check: "actual_render_guide_database",
      status: "BLOCKED",
      reason: safeReasons.has(error.message)
        ? error.message
        : "runtime_database_check_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  await client?.query("ROLLBACK").catch(() => {});
  await client?.end().catch(() => {});
}
