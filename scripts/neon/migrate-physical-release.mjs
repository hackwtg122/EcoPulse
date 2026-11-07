import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const apply = process.argv.includes("--apply");
if (!process.argv.includes("--dry-run") && !apply) throw Error("explicit_migration_mode_required");
const evidence = JSON.parse(await readFile(new URL("../qa/evidence/physical-release-isolated-2026-11-07.json",import.meta.url),"utf8"));
if (evidence.status !== "PASS" || evidence.restoredTablesMatched < 1 || evidence.productionBusinessWrites !== 0) throw Error("restore_test_required");
const archive = await readFile(process.env.ECOPULSE_VERIFIED_BACKUP || "");
if (createHash("sha256").update(archive).digest("hex") !== evidence.backupSha256) throw Error("verified_backup_mismatch");
const url = new URL(process.env.NEON_DATABASE_URL || "");
if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/neondb") throw Error("existing_neon_required");
url.searchParams.set("sslmode","verify-full");
const client = new pg.Client({ connectionString:url.href,connectionTimeoutMillis:15000 });
let stage="connect";
try {
  await client.connect(); await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'"); await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SELECT pg_advisory_xact_lock(741926244)");
  stage="preferences";
  const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='coordination_requests' AND column_name IN ('requested_point_id','preferred_at')")).rows;
  if (columns.length === 0) await client.query(await readFile(new URL("../../lib/db/drizzle/0006_coordination_preferences.sql",import.meta.url),"utf8"));
  else if (columns.length !== 2) throw Error("partial_preferences_schema");
  stage="photos";
  const state=(await client.query("SELECT to_regclass('public.reward_photos') IS NOT NULL AS present")).rows[0];
  if (!state.present) await client.query(await readFile(new URL("./reward-photos-migration.sql",import.meta.url),"utf8"));
  const photos = (await client.query(`SELECT to_regclass('public.reward_photo_events') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reward_photos' AND column_name='product_title') AS ready`)).rows[0];
  if (!photos.ready) throw Error("incompatible_photo_schema");
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(JSON.stringify({check:"physical_release_migration",status:"PASS",applied:apply,restoreVerified:true,businessWrites:0}));
} catch(error) {
  await client.query("ROLLBACK").catch(()=>{});
  console.log(JSON.stringify({check:"physical_release_migration",status:"FAIL",stage,sqlState:/^[A-Z0-9]{5}$/.test(error.code||"")?error.code:undefined}));
  process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
