import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../lib/db/src/schema/index.ts";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) {
  throw new Error(".env.local does not exist");
}

process.loadEnvFile(envFile);

const connectionUrl = new URL(process.env.DATABASE_URL);
const expected = {
  protocol: "postgresql:",
  hostname: "127.0.0.1",
  port: "5432",
  username: "ecopulse_app",
  database: "ecopulse_dev",
};
const actual = {
  protocol: connectionUrl.protocol,
  hostname: connectionUrl.hostname,
  port: connectionUrl.port,
  username: decodeURIComponent(connectionUrl.username),
  database: connectionUrl.pathname.slice(1),
};

for (const [key, value] of Object.entries(expected)) {
  if (actual[key] !== value) {
    throw new Error(`DATABASE_URL has unexpected ${key}`);
  }
}
if (!connectionUrl.password) {
  throw new Error("DATABASE_URL has no password");
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

try {
  const nodeResult = await pool.query(`
    SELECT
      current_user AS user_name,
      current_database() AS database_name,
      current_setting('server_version') AS server_version
  `);

  const drizzleResult = await db.execute(sql`SELECT 1 AS connected`);

  const permissions = await pool.query(`
    SELECT
      rolcanlogin,
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolreplication,
      rolbypassrls,
      has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_database,
      has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public_schema,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public_schema,
      pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) AS database_owner
    FROM pg_roles
    WHERE rolname = current_user
  `);

  const schemaState = await pool.query(`
    SELECT count(*)::integer AS application_table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [[
    "users",
    "scans",
    "deliveries",
    "verifications",
    "point_movements",
    "rewards",
    "redemptions",
  ]]);

  const identity = nodeResult.rows[0];
  const role = permissions.rows[0];
  const tableCount = schemaState.rows[0].application_table_count;

  if (identity.user_name !== expected.username || identity.database_name !== expected.database) {
    throw new Error("PostgreSQL returned an unexpected identity");
  }
  if (drizzleResult.rows[0]?.connected !== 1) {
    throw new Error("Drizzle connection check failed");
  }
  if (!role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls) {
    throw new Error("ecopulse_app has unexpected role attributes");
  }
  if (!role.can_connect || !role.can_use_public_schema || role.can_create_in_database || role.can_create_in_public_schema ||
      role.database_owner !== "ecopulse_migrator") {
    throw new Error("ecopulse_app has not yet been reduced to the expected runtime permissions");
  }

  console.log(JSON.stringify({
    nodePostgres: "connected",
    drizzle: "connected",
    user: identity.user_name,
    database: identity.database_name,
    serverVersion: identity.server_version,
    restrictedRole: true,
    applicationTablesPresent: tableCount,
    migrationStatus: tableCount === 0 ? "pending" : tableCount === 7 ? "applied" : "partially-applied",
  }, null, 2));
} finally {
  await pool.end();
}
