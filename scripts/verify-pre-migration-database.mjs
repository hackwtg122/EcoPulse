import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

const url = new URL(process.env.DATABASE_URL);
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "5432" ||
    decodeURIComponent(url.username) !== "ecopulse_app" || url.pathname !== "/ecopulse_dev") {
  throw new Error("DATABASE_URL does not target local ecopulse_dev as ecopulse_app");
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const identity = await pool.query(`
    SELECT current_user, current_database(), inet_server_addr()::text AS server_address,
      inet_server_port() AS server_port, current_setting('server_version') AS server_version,
      pg_get_userbyid(datdba) AS database_owner
    FROM pg_database WHERE datname = current_database()
  `);
  const objects = await pool.query(`
    SELECT count(*)::integer AS count FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE nspname = 'public' AND relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  `);
  const enums = await pool.query(`
    SELECT count(*)::integer AS count FROM pg_type
    JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE nspname = 'public' AND typtype = 'e'
  `);
  const historySchema = await pool.query("SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = 'drizzle'");
  const role = await pool.query(`
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
    FROM pg_roles WHERE rolname = current_user
  `);
  const migrator = await pool.query(`
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = 'ecopulse_migrator'
  `);

  const state = identity.rows[0];
  if (state.current_user !== "ecopulse_app" || state.current_database !== "ecopulse_dev" ||
      !["127.0.0.1", "127.0.0.1/32"].includes(state.server_address) || Number(state.server_port) !== 5432) {
    throw new Error(`Connected PostgreSQL identity is not the expected local development target: ${JSON.stringify({
      currentUser: state.current_user,
      database: state.current_database,
      serverAddress: state.server_address,
      serverPort: state.server_port,
    })}`);
  }
  if (objects.rows[0].count !== 0 || enums.rows[0].count !== 0 || historySchema.rows[0].count !== 0) {
    throw new Error("ecopulse_dev is not empty; stop before role or migration changes");
  }

  console.log(JSON.stringify({
    server: `${state.server_address}:${state.server_port}`,
    serverVersion: state.server_version,
    database: state.current_database,
    currentUser: state.current_user,
    databaseOwner: state.database_owner,
    publicObjects: objects.rows[0].count,
    publicEnums: enums.rows[0].count,
    drizzleHistorySchemaPresent: historySchema.rows[0].count === 1,
    role: role.rows[0],
    migratorRole: migrator.rows[0] ?? null,
    safeToPrepareRoles: true,
  }, null, 2));
} finally {
  await pool.end();
}
