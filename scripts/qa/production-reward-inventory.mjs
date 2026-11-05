import { pathToFileURL } from "node:url";
import { resolveDatabaseUrl } from "../../lib/db/src/connectionConfig.ts";
import { renderGuideEnvironment } from "./render-guide-environment.mjs";
import { verifyRewardInventory } from "../neon/verify-reward-inventory.mjs";
import { verifyRewardDraftRecovery } from "../neon/verify-reward-draft-recovery.mjs";

let client;
try {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "hackwtg122/EcoPulse" || process.env.GITHUB_REF !== "refs/heads/main") throw Error("official_runner_required");
  const { env } = await renderGuideEnvironment();
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
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ check: "production_reward_inventory_schema", status: "PASS", ...result, ...recovery, runtimePermissions: true, scope: "actual_render_database_not_admin_operation" }));
} catch (error) {
  await client?.query("ROLLBACK").catch(() => {});
  console.log(JSON.stringify({ check: "production_reward_inventory_schema", status: "BLOCKED", code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "schema_or_runtime_verification_failed" }));
  process.exitCode = 1;
} finally { await client?.end().catch(() => {}); }
