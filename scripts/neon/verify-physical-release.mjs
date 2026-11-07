import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import pg from "pg";

// Source is read-only. All migrations and fixture writes run on a restored,
// loopback-only PostgreSQL cluster. Archive/credentials never enter Git/logs.
const bin = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const source = new URL(process.env.NEON_DATABASE_URL || "");
if (!source.hostname.endsWith(".neon.tech") || source.pathname !== "/neondb") throw Error("existing_neon_required");
const work = join(process.env.LOCALAPPDATA, "Temp", "opencode", `ecopulse-release-${Date.now()}`);
await mkdir(work, { recursive: true });
const password = randomBytes(32).toString("hex");
const data = join(work, "data");
const archive = join(work, "neon.dump");
const pwfile = join(work, "password");
await writeFile(pwfile, password, { mode: 0o600 });
function run(name, args, env = {}) {
  const result = spawnSync(join(bin, `${name}.exe`), args, { env: { ...process.env, ...env }, encoding: "utf8", timeout: 180000, windowsHide: true });
  if (result.status !== 0) throw Error(`${name}_failed`);
  return result.stdout;
}
const client = new pg.Client({ connectionString: source.href, connectionTimeoutMillis: 15000 });
let local;
let pool;
let started = false;
let stage = "backup";
const report = { check: "physical_release_isolated", productionBusinessWrites: 0, authenticatedSessionsTested: 0 };
try {
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
  run("pg_dump", ["--format=custom", "--no-password", `--snapshot=${snapshot}`, `--file=${archive}`], {
    PGHOST: source.hostname, PGPORT: source.port || "5432", PGDATABASE: "neondb",
    PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password), PGSSLMODE: "require",
  });
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  const signatures = {};
  const signature = async (db, table) => (await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row::text,E'\\n' ORDER BY row::text COLLATE "C"),'')) AS hash FROM (SELECT to_jsonb(t) AS row FROM public."${table.replaceAll('"','""')}" t) s`)).rows[0];
  for (const table of tables) signatures[table] = await signature(client, table);
  const roles = (await client.query("SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname<>'postgres'")).rows;
  const tableGrants=(await client.query("SELECT table_name,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee='ecopulse_app'")).rows;
  const columnGrants=(await client.query("SELECT table_name,column_name,privilege_type FROM information_schema.role_column_grants WHERE table_schema='public' AND grantee='ecopulse_app'")).rows;
  await client.query("ROLLBACK");
  stage = "restore";
  run("initdb", ["-D", data, "-U", "restore_admin", "-A", "scram-sha-256", `--pwfile=${pwfile}`, "--encoding=UTF8", "--locale=C"]);
  run("pg_ctl", ["-D", data, "-l", join(work, "postgres.log"), "-o", "-p 55437 -h 127.0.0.1 -c max_connections=40", "-w", "start"]);
  started = true;
  const localUrl = `postgresql://restore_admin:${password}@127.0.0.1:55437/postgres`;
  local = new pg.Client({ connectionString: localUrl });
  await local.connect();
  for (const { rolname } of roles) await local.query(`CREATE ROLE "${rolname.replaceAll('"','""')}" NOLOGIN`);
  await local.query("CREATE DATABASE ecopulse_release");
  await local.end();
  run("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--dbname=ecopulse_release", archive], {
    PGHOST: "127.0.0.1", PGPORT: "55437", PGDATABASE: "ecopulse_release", PGUSER: "restore_admin", PGPASSWORD: password, PGSSLMODE: "disable",
  });
  pool = new pg.Pool({ connectionString: localUrl.replace(/postgres$/, "ecopulse_release"), max: 20, connectionTimeoutMillis: 15000, options: "-c timezone=UTC" });
  for (const table of tables) {
    const actual = await signature(pool, table);
    if (JSON.stringify(actual) !== JSON.stringify(signatures[table])) { report.mismatchTable = table; throw Error("restored_data_mismatch"); }
  }
  report.restoredTablesMatched = tables.length;
  report.backupSha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
  stage = "isolated_migrations";
  const pref = (await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='coordination_requests' AND column_name IN ('preferred_at','requested_point_id')")).rows[0].n;
  if (pref === 0) await pool.query(await readFile(new URL("../../lib/db/drizzle/0006_coordination_preferences.sql", import.meta.url), "utf8"));
  else if(pref !== 2) throw Error("partial_preferences_schema");
  const photos=(await pool.query("SELECT to_regclass('public.reward_photos') IS NOT NULL AS present")).rows[0].present;
  if(!photos) await pool.query(await readFile(new URL("./reward-photos-migration.sql", import.meta.url), "utf8"));
  const quote=name=>`"${name.replaceAll('"','""')}"`;
  for(const grant of tableGrants) await pool.query(`GRANT ${grant.privilege_type} ON public.${quote(grant.table_name)} TO ecopulse_app`);
  for(const grant of columnGrants) await pool.query(`GRANT ${grant.privilege_type} (${quote(grant.column_name)}) ON public.${quote(grant.table_name)} TO ecopulse_app`);
  // --no-acl deliberately omitted sequence privileges in the restored archive.
  await pool.query("GRANT USAGE ON SEQUENCE reward_photo_events_id_seq TO ecopulse_app");
  await pool.end();
  pool=new pg.Pool({connectionString:localUrl.replace(/postgres$/,"ecopulse_release"),max:20,connectionTimeoutMillis:15000,options:"-c timezone=UTC -c role=ecopulse_app"});
  report.runtimeRoleTested=(await pool.query("SELECT current_user AS role")).rows[0].role;
  stage = "isolated_concurrency";
  const { verifyIsolatedPhysicalFlows } = await import("../qa/isolated-physical-flows.mjs");
  Object.assign(report, await verifyIsolatedPhysicalFlows(pool));
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.stage = stage;
  report.reason = /^[a-z_]+$/.test(error.message || "") ? error.message : "isolated_verification_failed";
  report.errorType = error.name;
  if (/^ERR_[A-Z_]+$/.test(error.code || "")) report.nodeCode = error.code;
  report.location = error.stack?.split("\n").find(line => /^\s+at /.test(line))?.replace(/.*at /, "");
  if (/^[A-Z0-9]{5}$/.test(error.code || "")) report.sqlState = error.code;
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
  await pool?.end();
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  // Keep the archive and isolated cluster as a recoverable backup. Password
  // file is local-only, never returned in the sanitized evidence.
  await writeFile(new URL("../qa/evidence/physical-release-isolated-2026-11-07.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
