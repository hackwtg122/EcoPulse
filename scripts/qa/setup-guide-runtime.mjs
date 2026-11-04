import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import {
  resolveDatabaseUrl,
  resolveGuideDatabaseUrl,
} from "../../lib/db/src/connectionConfig.ts";
import { createGuideRuntimeRole } from "../neon/guide-runtime-role.mjs";
import { renderGuideEnvironment } from "./render-guide-environment.mjs";

let owner, probe;
const safeReasons = new Set([
  "explicit_setup_authorization_required",
  "existing_guide_role_requires_review",
  "guide_schema_missing",
  "runtime_database_requires_review",
  "guide_runtime_not_restricted",
  "guide_runtime_excessive_public_privileges",
  "render_read_failed",
  "official_service_not_unique",
  "official_runner_required",
  "render_access_missing",
]);
try {
  if (
    process.env.GUIDE_RUNTIME_SETUP_AUTHORIZED !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
  )
    throw new Error("explicit_setup_authorization_required");
  const access = await renderGuideEnvironment();
  const { default: pg } = await import(
    pathToFileURL(process.env.PROD_QA_PG_MODULE).href
  );
  let guideUrl = access.env.GUIDE_DATABASE_URL;
  let created = false;
  let schemaApplied = false;
  if (!guideUrl) {
    const url = new URL(resolveDatabaseUrl(access.env));
    if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb")
      throw new Error("runtime_database_requires_review");
    url.searchParams.set("sslmode", "verify-full");
    owner = new pg.Client({
      connectionString: url.href,
      connectionTimeoutMillis: 15000,
    });
    await owner.connect();
    await owner.query("BEGIN");
    await owner.query("SET LOCAL lock_timeout='3s'");
    await owner.query("SET LOCAL statement_timeout='20s'");
    await owner.query("SELECT pg_advisory_xact_lock(741926239)");
    const schema = (
      await owner.query(
        "SELECT to_regclass('public.guide_conversations') IS NOT NULL AS conversations,to_regclass('public.guide_turns') IS NOT NULL AS turns",
      )
    ).rows[0];
    if (!schema.conversations && !schema.turns) {
      await owner.query(
        await readFile(
          new URL(
            "../neon/ecoguide-persistence-migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      schemaApplied = true;
    }
    const credentials = await createGuideRuntimeRole(owner);
    url.username = credentials.role;
    url.password = credentials.password;
    guideUrl = url.href;
    // Store only the new guide connection; do not overwrite DATABASE_URL or
    // existing roles. A failed Render write rolls the new role back.
    await access.setGuideUrl(guideUrl);
    await owner.query("COMMIT");
    created = true;
  }
  const connection = resolveGuideDatabaseUrl({
    ...access.env,
    GUIDE_DATABASE_URL: guideUrl,
  });
  probe = new pg.Client({
    connectionString: connection,
    connectionTimeoutMillis: 15000,
  });
  await probe.connect();
  await probe.query("BEGIN READ ONLY");
  await probe.query("SET LOCAL statement_timeout='15s'");
  const role = (
    await probe.query(
      "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (
    !role ||
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolcreatedb ||
    role.rolcreaterole
  )
    throw new Error("guide_runtime_not_restricted");
  for (const table of ["guide_conversations", "guide_turns"]) {
    if (
      !(
        await probe.query(
          "SELECT row_security_active($1::regclass) AS active",
          [`public.${table}`],
        )
      ).rows[0].active
    )
      throw new Error("guide_runtime_not_restricted");
    if (
      (await probe.query(`SELECT count(*)::int AS count FROM public.${table}`))
        .rows[0].count !== 0
    )
      throw new Error("guide_runtime_not_restricted");
  }
  console.log(
    JSON.stringify({
      check: "guide_least_privilege_setup",
      status: "PASS",
      schemaApplied,
      newRoleCreated: created,
      existingRolesChanged: false,
      primaryDatabaseUrlChanged: false,
      rlsActive: true,
      conversationRecordsCreated: 0,
    }),
  );
} catch (error) {
  await owner?.query("ROLLBACK").catch(() => {});
  console.log(
    JSON.stringify({
      check: "guide_least_privilege_setup",
      status: "BLOCKED",
      reason: safeReasons.has(error.message)
        ? error.message
        : "guide_runtime_setup_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  await probe?.query("ROLLBACK").catch(() => {});
  await probe?.end().catch(() => {});
  await owner?.end().catch(() => {});
}
