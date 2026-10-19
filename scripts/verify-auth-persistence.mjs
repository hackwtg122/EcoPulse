import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

const connectionUrl = new URL(process.env.DATABASE_URL);
if (
  connectionUrl.protocol !== "postgresql:" ||
  connectionUrl.hostname !== "127.0.0.1" ||
  connectionUrl.port !== "5432" ||
  decodeURIComponent(connectionUrl.username) !== "ecopulse_app" ||
  connectionUrl.pathname !== "/ecopulse_dev"
) {
  throw new Error("DATABASE_URL does not point to the expected local development database");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(`
    SELECT
      count(*)::integer AS total_users,
      count(DISTINCT clerk_user_id)::integer AS distinct_clerk_users,
      count(*) FILTER (WHERE role NOT IN ('participant', 'verifier', 'admin'))::integer AS invalid_roles
    FROM users
  `);
  const state = result.rows[0];
  if (state.total_users < 1) throw new Error("No authenticated user has been persisted");
  if (state.total_users !== state.distinct_clerk_users) throw new Error("Duplicate Clerk users were found");
  if (state.invalid_roles !== 0) throw new Error("A user has an invalid application role");

  console.log(JSON.stringify({
    database: "ecopulse_dev",
    runtimeRole: "ecopulse_app",
    persistedUsers: state.total_users,
    duplicateClerkUsers: 0,
    validRoles: true,
    credentialsPrinted: false,
  }, null, 2));
} finally {
  await pool.end();
}
