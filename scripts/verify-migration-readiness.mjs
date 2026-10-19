import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
const initialMigrationFile = fileURLToPath(new URL("../lib/db/drizzle/0000_core.sql", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

function validateUrl(name, expectedUser) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  const url = new URL(value);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5432" ||
    decodeURIComponent(url.username) !== expectedUser ||
    url.pathname !== "/ecopulse_dev" ||
    !url.password
  ) {
    throw new Error(`${name} does not target the expected local development identity`);
  }
  return value;
}

const appPool = new pg.Pool({ connectionString: validateUrl("DATABASE_URL", "ecopulse_app") });
const migratorPool = new pg.Pool({ connectionString: validateUrl("MIGRATION_DATABASE_URL", "ecopulse_migrator") });
const expectedCoreTables = ["deliveries", "point_movements", "redemptions", "rewards", "scans", "users", "verifications"];
const preservedDeliveryId = "ece719a5-739e-5626-a6b8-727b5dca04ce";

try {
  const [appIdentity, migratorIdentity, tables, migrations, state] = await Promise.all([
    appPool.query(`
      SELECT current_user, current_database(),
        has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
        has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
        rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `),
    migratorPool.query(`
      SELECT current_user, current_database(), current_setting('server_version') AS server_version,
        pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) AS database_owner,
        pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'public')) AS schema_owner,
        has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
        rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `),
    migratorPool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `),
    migratorPool.query(`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
    `),
    migratorPool.query(`
      SELECT
        (SELECT count(*)::integer FROM users) AS users,
        (SELECT count(*)::integer FROM scans) AS scans,
        (SELECT count(*)::integer FROM deliveries) AS deliveries,
        (SELECT count(*)::integer FROM deliveries WHERE id = $1 AND status = 'pending') AS preserved_delivery,
        (SELECT count(*)::integer FROM verifications) AS verifications,
        (SELECT count(*)::integer FROM point_movements) AS point_movements,
        (SELECT count(*)::integer FROM rewards) AS rewards,
        (SELECT count(*)::integer FROM redemptions) AS redemptions
    `, [preservedDeliveryId]),
  ]);

  const app = appIdentity.rows[0];
  const migrator = migratorIdentity.rows[0];
  assert.equal(app.current_user, "ecopulse_app");
  assert.equal(app.current_database, "ecopulse_dev");
  assert.equal(app.database_create, false);
  assert.equal(app.schema_create, false);
  for (const attribute of ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"]) {
    assert.equal(app[attribute], false, `ecopulse_app must not have ${attribute}`);
    assert.equal(migrator[attribute], false, `ecopulse_migrator must not have ${attribute}`);
  }
  assert.equal(migrator.current_user, "ecopulse_migrator");
  assert.equal(migrator.current_database, "ecopulse_dev");
  assert.equal(migrator.database_owner, "ecopulse_migrator");
  assert.equal(migrator.schema_owner, "ecopulse_migrator");
  assert.equal(migrator.schema_create, true);

  assert.deepEqual(tables.rows.map((row) => row.tablename), expectedCoreTables);
  assert.equal(migrations.rowCount, 1, "Only 0000_core may be applied to ecopulse_dev");
  const initialHash = createHash("sha256").update(readFileSync(initialMigrationFile)).digest("hex");
  assert.equal(migrations.rows[0].hash, initialHash, "Applied 0000 hash differs from the canonical file");

  assert.deepEqual(state.rows[0], {
    users: 2,
    scans: 1,
    deliveries: 1,
    preserved_delivery: 1,
    verifications: 0,
    point_movements: 0,
    rewards: 0,
    redemptions: 0,
  });

  console.log(JSON.stringify({
    database: "ecopulse_dev",
    serverVersion: migrator.server_version,
    applicationRoleRestricted: true,
    migratorRoleRestricted: true,
    databaseOwner: migrator.database_owner,
    schemaOwner: migrator.schema_owner,
    appliedMigrations: ["0000_core"],
    appliedCoreHashMatches: true,
    pendingMigrations: ["0001_delivery_details"],
    currentTables: expectedCoreTables.length,
    preservedState: state.rows[0],
    safeForIsolatedTesting: true,
    appliedToDevelopment: false,
    credentialsPrinted: false,
  }, null, 2));
} finally {
  await Promise.allSettled([appPool.end(), migratorPool.end()]);
}
