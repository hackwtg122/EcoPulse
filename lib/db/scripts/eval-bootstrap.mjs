// Prepared only. Do not run without authorization for ecopulse_eval.
// Uses the canonical Drizzle 0000-0003 migrations and writes their journal.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";

const connection = process.env.EVALUATION_MIGRATION_DATABASE_URL;
const primary = process.env.DATABASE_URL;
if (!connection || !primary) throw new Error("Separate primary and evaluation migration URLs are required");
const target = new URL(connection);
const source = new URL(primary);
if (!["postgres:", "postgresql:"].includes(target.protocol) ||
    target.pathname !== "/ecopulse_eval" || target.href === source.href ||
    target.pathname === source.pathname) {
  throw new Error("Migration must target an independent ecopulse_eval database");
}

const pool = new pg.Pool({ connectionString: connection, max: 1 });
try {
  const result = await pool.query(`SELECT current_database() AS name,
    to_regclass('public.users') IS NULL AS empty,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ecopulse_app') AS app_role`);
  if (result.rows[0]?.name !== "ecopulse_eval" || !result.rows[0]?.empty || !result.rows[0]?.app_role) {
    throw new Error("Expected empty ecopulse_eval and existing ecopulse_app role");
  }
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)),
  });
} finally {
  await pool.end();
}
