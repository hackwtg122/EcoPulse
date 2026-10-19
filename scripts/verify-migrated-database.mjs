import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

if (!process.env.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL) {
  throw new Error("DATABASE_URL and MIGRATION_DATABASE_URL must be configured");
}

const { Pool } = pg;
const runtimePool = new Pool({ connectionString: process.env.DATABASE_URL });
const migratorPool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const structureOnly = process.argv.includes("--structure-only");

const expectedTables = [
  "deliveries", "point_movements", "redemptions", "rewards", "scans", "users", "verifications",
];
const expectedEnums = ["delivery_status", "movement_kind", "user_role"];
const expectedChecks = [
  "point_movements_delta_check",
  "point_movements_direction_check",
  "redemptions_cost_check",
  "redemptions_idempotency_length_check",
  "rewards_cost_check",
  "rewards_description_length_check",
  "rewards_title_length_check",
  "scans_category_length_check",
  "scans_source_check",
  "verifications_decision_check",
  "verifications_weight_check",
];
const expectedIndexes = [
  "deliveries_user_created_idx",
  "point_movements_source_unique",
  "point_movements_user_created_idx",
  "redemptions_idempotency_unique",
  "redemptions_user_created_idx",
  "scans_user_created_idx",
  "verifications_delivery_unique",
  "verifications_receipt_unique",
];
const permissions = {
  users: ["SELECT", "INSERT"],
  scans: ["SELECT", "INSERT"],
  deliveries: ["SELECT", "INSERT", "UPDATE"],
  verifications: ["INSERT"],
  point_movements: ["SELECT", "INSERT"],
  rewards: ["SELECT"],
  redemptions: ["SELECT", "INSERT"],
};

function sameMembers(actual, expected) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

async function applicationRowCount(pool) {
  const result = await pool.query(`
    SELECT (
      (SELECT count(*) FROM users) +
      (SELECT count(*) FROM scans) +
      (SELECT count(*) FROM deliveries) +
      (SELECT count(*) FROM verifications) +
      (SELECT count(*) FROM point_movements) +
      (SELECT count(*) FROM rewards) +
      (SELECT count(*) FROM redemptions)
    )::integer AS count
  `);
  return result.rows[0].count;
}

async function expectSqlState(client, label, text, values, sqlState) {
  const savepoint = `test_${label.replaceAll(/[^a-z0-9]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(text, values);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (error?.code !== sqlState) {
      throw new Error(`${label} returned SQLSTATE ${error?.code ?? "unknown"}; expected ${sqlState}`);
    }
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  throw new Error(`${label} unexpectedly succeeded`);
}

try {
  const runtimeIdentity = await runtimePool.query("SELECT current_user, current_database()");
  if (runtimeIdentity.rows[0].current_user !== "ecopulse_app" || runtimeIdentity.rows[0].current_database !== "ecopulse_dev") {
    throw new Error("Runtime connection has an unexpected identity");
  }

  const tables = await migratorPool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tableNames = tables.rows.map((row) => row.table_name);
  if (!sameMembers(tableNames, expectedTables)) throw new Error("Application table inventory is unexpected");

  const tableOwners = await migratorPool.query(`
    SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[])
  `, [expectedTables]);
  if (tableOwners.rows.length !== expectedTables.length ||
      tableOwners.rows.some((row) => row.owner !== "ecopulse_migrator")) {
    throw new Error("Application tables are not exclusively owned by ecopulse_migrator");
  }

  const enums = await migratorPool.query(`
    SELECT typname FROM pg_type JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE nspname = 'public' AND typtype = 'e' ORDER BY typname
  `);
  if (!sameMembers(enums.rows.map((row) => row.typname), expectedEnums)) throw new Error("Enum inventory is unexpected");

  const checks = await migratorPool.query(`
    SELECT conname FROM pg_constraint
    JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
    WHERE nspname = 'public' AND contype = 'c' ORDER BY conname
  `);
  if (!sameMembers(checks.rows.map((row) => row.conname), expectedChecks)) throw new Error("Check constraint inventory is unexpected");

  const foreignKeys = await migratorPool.query(`
    SELECT count(*)::integer AS count FROM pg_constraint
    JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
    WHERE nspname = 'public' AND contype = 'f'
  `);
  if (foreignKeys.rows[0].count !== 7) throw new Error("Expected seven foreign keys");

  const indexes = await migratorPool.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY($1::text[])
    ORDER BY indexname
  `, [expectedIndexes]);
  if (!sameMembers(indexes.rows.map((row) => row.indexname), expectedIndexes)) throw new Error("Required index inventory is incomplete");

  const trigger = await migratorPool.query(`
    SELECT count(*)::integer AS count FROM pg_trigger
    JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE nspname = 'public' AND relname = 'point_movements'
      AND tgname = 'point_movements_append_only' AND NOT tgisinternal
  `);
  if (trigger.rows[0].count !== 1) throw new Error("Append-only point movement trigger is missing");

  const history = await migratorPool.query(`
    SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at
  `);
  const migrationFile = fileURLToPath(new URL("../lib/db/drizzle/0000_core.sql", import.meta.url));
  const expectedHash = createHash("sha256").update(readFileSync(migrationFile)).digest("hex");
  if (history.rows.length !== 1 || history.rows[0].hash !== expectedHash) {
    throw new Error("Drizzle migration history does not match the reviewed migration file");
  }

  const runtimeRole = await migratorPool.query(`
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
      has_database_privilege('ecopulse_app', 'ecopulse_dev', 'CREATE') AS database_create,
      has_schema_privilege('ecopulse_app', 'public', 'CREATE') AS schema_create
    FROM pg_roles WHERE rolname = 'ecopulse_app'
  `);
  const role = runtimeRole.rows[0];
  if (!role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication ||
      role.rolbypassrls || role.database_create || role.schema_create) {
    throw new Error("Runtime role privileges are broader than expected");
  }

  for (const table of expectedTables) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const result = await migratorPool.query(
        "SELECT has_table_privilege('ecopulse_app', $1, $2) AS allowed",
        [`public.${table}`, privilege],
      );
      const shouldAllow = structureOnly ? false : permissions[table].includes(privilege);
      if (result.rows[0].allowed !== shouldAllow) {
        throw new Error(`Unexpected ${privilege} privilege on ${table}`);
      }
    }
  }

  const baselineApplicationRows = await applicationRowCount(migratorPool);
  const client = await migratorPool.connect();
  try {
    await client.query("BEGIN");
    const participant = `test_participant_${randomUUID()}`;
    const verifier = `test_verifier_${randomUUID()}`;
    const deliveryId = randomUUID();
    const verificationId = randomUUID();
    const movementId = randomUUID();
    const rewardId = randomUUID();
    const redemptionId = randomUUID();

    await client.query("INSERT INTO users (clerk_user_id, role) VALUES ($1, 'participant'), ($2, 'verifier')", [participant, verifier]);
    await client.query("INSERT INTO deliveries (id, user_id) VALUES ($1, $2)", [deliveryId, participant]);
    await client.query(`
      INSERT INTO verifications (id, delivery_id, verifier_id, decision, verified_grams, receipt_code)
      VALUES ($1, $2, $3, 'approved', 1000, 'TEST0001')
    `, [verificationId, deliveryId, verifier]);
    await client.query(`
      INSERT INTO point_movements (id, user_id, delta, kind, source_id)
      VALUES ($1, $2, 10, 'delivery', $3)
    `, [movementId, participant, verificationId]);
    await client.query("INSERT INTO rewards (id, title, description, cost) VALUES ($1, 'Test', 'Transactional test', 5)", [rewardId]);
    await client.query(`
      INSERT INTO redemptions (id, user_id, reward_id, cost, idempotency_key)
      VALUES ($1, $2, $3, 5, 'test-key-0001')
    `, [redemptionId, participant, rewardId]);

    await expectSqlState(client, "foreign_key", "INSERT INTO scans (id, user_id, category, source) VALUES ($1, 'missing-user', 'paper', 'manual')", [randomUUID()], "23503");
    await expectSqlState(client, "scan_source", "INSERT INTO scans (id, user_id, category, source) VALUES ($1, $2, 'paper', 'invalid')", [randomUUID(), participant], "23514");
    await expectSqlState(client, "verification_unique", `INSERT INTO verifications (id, delivery_id, verifier_id, decision) VALUES ($1, $2, $3, 'rejected')`, [randomUUID(), deliveryId, verifier], "23505");
    await expectSqlState(client, "movement_direction", "INSERT INTO point_movements (id, user_id, delta, kind, source_id) VALUES ($1, $2, -1, 'delivery', $3)", [randomUUID(), participant, randomUUID()], "23514");
    await expectSqlState(client, "redemption_idempotency", `INSERT INTO redemptions (id, user_id, reward_id, cost, idempotency_key) VALUES ($1, $2, $3, 5, 'test-key-0001')`, [randomUUID(), participant, rewardId], "23505");
    await expectSqlState(client, "movement_update", "UPDATE point_movements SET delta = 11 WHERE id = $1", [movementId], "55000");
    await expectSqlState(client, "movement_delete", "DELETE FROM point_movements WHERE id = $1", [movementId], "55000");

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!structureOnly) {
    const runtimeClient = await runtimePool.connect();
    try {
      await runtimeClient.query("BEGIN");
      const participant = `runtime_participant_${randomUUID()}`;
      const verifier = `runtime_verifier_${randomUUID()}`;
      const scanId = randomUUID();
      const deliveryId = randomUUID();
      const verificationId = randomUUID();
      const movementId = randomUUID();

      await runtimeClient.query("INSERT INTO users (clerk_user_id) VALUES ($1), ($2)", [participant, verifier]);
      await runtimeClient.query("SELECT role FROM users WHERE clerk_user_id = $1", [participant]);
      await runtimeClient.query("INSERT INTO scans (id, user_id, category, source) VALUES ($1, $2, 'paper', 'manual')", [scanId, participant]);
      await runtimeClient.query("SELECT id FROM scans WHERE user_id = $1", [participant]);
      await runtimeClient.query("INSERT INTO deliveries (id, user_id) VALUES ($1, $2)", [deliveryId, participant]);
      await runtimeClient.query("UPDATE deliveries SET status = 'approved' WHERE id = $1", [deliveryId]);
      await runtimeClient.query("SELECT id FROM deliveries WHERE user_id = $1", [participant]);
      await runtimeClient.query(`
        INSERT INTO verifications (id, delivery_id, verifier_id, decision, verified_grams, receipt_code)
        VALUES ($1, $2, $3, 'approved', 1000, 'RUNTIME01')
      `, [verificationId, deliveryId, verifier]);
      await runtimeClient.query(`
        INSERT INTO point_movements (id, user_id, delta, kind, source_id)
        VALUES ($1, $2, 10, 'delivery', $3)
      `, [movementId, participant, verificationId]);
      await runtimeClient.query("SELECT sum(delta) FROM point_movements WHERE user_id = $1", [participant]);
      await runtimeClient.query("SELECT id FROM rewards WHERE active = true");
      await runtimeClient.query("SELECT id FROM redemptions WHERE user_id = $1", [participant]);
      await expectSqlState(runtimeClient, "runtime_redemption_insert", `
        INSERT INTO redemptions (id, user_id, reward_id, cost, idempotency_key)
        VALUES ($1, $2, $3, 1, 'runtime-test-key')
      `, [randomUUID(), participant, randomUUID()], "23503");
      await expectSqlState(runtimeClient, "runtime_movement_update", "UPDATE point_movements SET delta = 11 WHERE id = $1", [movementId], "42501");
      await expectSqlState(runtimeClient, "runtime_movement_delete", "DELETE FROM point_movements WHERE id = $1", [movementId], "42501");
      await expectSqlState(runtimeClient, "runtime_create_table", "CREATE TABLE public.runtime_ddl_denied (id integer)", [], "42501");
      await expectSqlState(runtimeClient, "runtime_alter_table", "ALTER TABLE public.users ADD COLUMN runtime_ddl_denied integer", [], "42501");
      await expectSqlState(runtimeClient, "runtime_drop_table", "DROP TABLE public.users", [], "42501");
      await runtimeClient.query("ROLLBACK");
    } catch (error) {
      await runtimeClient.query("ROLLBACK");
      throw error;
    } finally {
      runtimeClient.release();
    }
  }

  const persistedApplicationRows = await applicationRowCount(migratorPool);
  if (persistedApplicationRows !== baselineApplicationRows) {
    throw new Error("Verification changed the persistent application row count");
  }

  console.log(JSON.stringify({
    migrationHistory: "recorded",
    tables: expectedTables.length,
    foreignKeys: 7,
    checks: expectedChecks.length,
    requiredIndexes: expectedIndexes.length,
    pointMovements: "append-only",
    runtimePermissions: structureOnly ? "no-table-access-before-grants" : "least-privilege",
    runtimeOperations: structureOnly ? "not-run-before-grants" : "allowed-and-denied-paths-verified",
    tableOwnership: "ecopulse_migrator",
    runtimeDdl: structureOnly ? "not-run-before-grants" : "create-alter-drop-denied",
    transactionalTests: "rolled-back-successfully",
    baselineApplicationRows,
    persistedApplicationRows,
  }, null, 2));
} finally {
  await Promise.allSettled([runtimePool.end(), migratorPool.end()]);
}
