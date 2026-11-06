import { pathToFileURL } from "node:url";
import { resolveDatabaseUrl } from "../../lib/db/src/connectionConfig.ts";
import { renderGuideEnvironment } from "./render-guide-environment.mjs";
import { verifyRewardInventory } from "../neon/verify-reward-inventory.mjs";
import { verifyRewardDraftRecovery } from "../neon/verify-reward-draft-recovery.mjs";
import { platformStatus, readPlatformEnvironment } from "../../artifacts/api-server/src/lib/platformActivation.ts";

let client;
let stage = "runtime_environment";
let activationDiagnostics;
try {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "hackwtg122/EcoPulse" || process.env.GITHUB_REF !== "refs/heads/main") throw Error("official_runner_required");
  const { env } = await renderGuideEnvironment({ includePlatformConfiguration: true });
  if (env.EVALUATION_MODE_ENABLED === "true") throw Error("production_database_required");
  const url = new URL(resolveDatabaseUrl(env));
  if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb") throw Error("production_database_required");
  url.searchParams.set("sslmode", "verify-full");
  const { default: pg } = await import(pathToFileURL(process.env.PROD_QA_PG_MODULE).href);
  client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 15000 });
  await client.connect(); await client.query("BEGIN READ ONLY"); await client.query("SET LOCAL statement_timeout='15s'");
  const result = await verifyRewardInventory(client);
  const recovery = await verifyRewardDraftRecovery(client);
  const { rows: [permissions] } = await client.query(`SELECT has_table_privilege(current_user,'public.reward_inventory_movements','SELECT') AND
    has_table_privilege(current_user,'public.reward_inventory_movements','INSERT') AND
    has_column_privilege(current_user,'public.rewards','inventory_remaining','UPDATE') AND
    has_column_privilege(current_user,'public.rewards','active','UPDATE') AND
    has_column_privilege(current_user,'public.rewards','updated_at','UPDATE') AS ready`);
  if (!permissions.ready) throw Error("runtime_inventory_permissions_missing");
  const { rows: [recoveryPermissions] } = await client.query(`SELECT has_table_privilege(current_user,'public.reward_draft_recoveries','SELECT') AND
    has_table_privilege(current_user,'public.reward_draft_recoveries','INSERT') AS ready`);
  if (!recoveryPermissions.ready) throw Error("runtime_recovery_permissions_missing");
  stage = "platform_activation_permissions";
  const { rows: [activationPermissions] } = await client.query(`SELECT
    current_user='ecopulse_app' AS dedicated_role,
    has_table_privilege(current_user,'public.platform_activation_events','UPDATE,DELETE,TRUNCATE') AS mutable_audit,
    obj_description('public.platform_activation_events'::regclass,'pg_class')='ecopulse:platform-activation:v1' AND
    has_table_privilege(current_user,'public.platform_activation_events','SELECT') AND
    has_table_privilege(current_user,'public.platform_activation_events','INSERT') AND
    has_sequence_privilege(current_user,'public.platform_activation_events_revision_seq','USAGE') AND
    NOT has_table_privilege('ecopulse_app','public.platform_activation_events','UPDATE,DELETE,TRUNCATE') AND
    (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='public.platform_activation_events'::regclass AND
      tgname IN ('platform_activation_events_immutable','platform_activation_events_no_truncate') AND tgenabled='O') AS ready`);
  activationDiagnostics = { dedicatedRole: activationPermissions.dedicated_role, mutableAudit: activationPermissions.mutable_audit, permissionsReady: activationPermissions.ready };
  if (!activationPermissions.ready) throw Error("runtime_platform_activation_permissions_missing");
  stage = "platform_readiness";
  const queryPool = { query: client.query.bind(client) };
  const effectiveEnvironment = await readPlatformEnvironment(queryPool, env);
  const platform = await platformStatus(queryPool, effectiveEnvironment);
  if (!platform.activationReady || platform.modules.length !== 6) throw Error("platform_readiness_unavailable");
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ check: "production_reward_inventory_schema", status: "PASS", ...result, ...recovery, runtimePermissions: true,
    activationRuntimePermissions: true, platformModules: platform.modules.map(({ key, ready, missing }) => ({ key, ready, missingConditions: missing.length })),
    activationAuditImmutable: true, runtimeUsesDedicatedRole: activationPermissions.dedicated_role,
    runtimeCredentialHardeningPending: activationPermissions.mutable_audit,
    scope: "actual_render_database_not_admin_operation" }));
} catch (error) {
  await client?.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "production_reward_inventory_schema", status: "BLOCKED", stage, activationDiagnostics,
    code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "schema_or_runtime_verification_failed" }));
  process.exitCode = 1;
} finally { await client?.end().catch(() => {}); }
