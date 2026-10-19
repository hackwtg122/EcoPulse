import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

const databaseUrl = new URL(process.env.DATABASE_URL);
if (
  databaseUrl.protocol !== "postgresql:" ||
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.port !== "5432" ||
  decodeURIComponent(databaseUrl.username) !== "ecopulse_app" ||
  databaseUrl.pathname !== "/ecopulse_dev"
) {
  throw new Error("DATABASE_URL does not point to the expected local development database and runtime role");
}

const migrationDatabaseUrl = new URL(process.env.MIGRATION_DATABASE_URL);
if (
  migrationDatabaseUrl.protocol !== "postgresql:" ||
  migrationDatabaseUrl.hostname !== "127.0.0.1" ||
  migrationDatabaseUrl.port !== "5432" ||
  decodeURIComponent(migrationDatabaseUrl.username) !== "ecopulse_migrator" ||
  migrationDatabaseUrl.pathname !== "/ecopulse_dev"
) {
  throw new Error("MIGRATION_DATABASE_URL does not point to the expected local development database and migrator role");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const auditPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  const deliveries = await pool.query(`
    SELECT id, user_id, status, created_at
    FROM deliveries
    ORDER BY created_at, id
  `);
  assert.equal(deliveries.rowCount, 1, "Exactly one persistent delivery is expected");
  const delivery = deliveries.rows[0];
  assert.equal(delivery.status, "pending");

  const scans = await pool.query(`
    SELECT user_id, category, source
    FROM scans
    ORDER BY created_at, id
  `);
  assert.equal(scans.rowCount, 1, "The existing scan must remain present");
  assert.equal(scans.rows[0].category, "paper");
  assert.equal(scans.rows[0].source, "manual");
  assert.equal(delivery.user_id, scans.rows[0].user_id, "The delivery must belong to the second account that owns the scan");

  const users = await pool.query("SELECT clerk_user_id FROM users ORDER BY created_at, clerk_user_id");
  assert.ok(users.rowCount >= 2, "At least two accounts must remain present");
  const principalUser = users.rows.find((row) => row.clerk_user_id !== delivery.user_id);
  assert.ok(principalUser, "The principal account must remain distinct from the delivery owner");

  const ownerDeliveries = await pool.query(
    "SELECT count(*)::integer AS count FROM deliveries WHERE user_id = $1",
    [delivery.user_id],
  );
  const principalDeliveries = await pool.query(
    "SELECT count(*)::integer AS count FROM deliveries WHERE user_id = $1",
    [principalUser.clerk_user_id],
  );
  const verifications = await auditPool.query(
    "SELECT count(*)::integer AS count FROM verifications WHERE delivery_id = $1",
    [delivery.id],
  );
  const movements = await pool.query(
    "SELECT count(*)::integer AS count, coalesce(sum(delta), 0)::integer AS balance FROM point_movements WHERE user_id = $1",
    [delivery.user_id],
  );

  assert.equal(ownerDeliveries.rows[0].count, 1);
  assert.equal(principalDeliveries.rows[0].count, 0);
  assert.equal(verifications.rows[0].count, 0);
  assert.equal(movements.rows[0].count, 0);
  assert.equal(movements.rows[0].balance, 0);

  console.log(JSON.stringify({
    database: "ecopulse_dev",
    runtimeRole: "ecopulse_app",
    deliveryId: delivery.id,
    deliveryStatus: delivery.status,
    persistentDeliveryCount: deliveries.rowCount,
    ownerDeliveryCount: ownerDeliveries.rows[0].count,
    principalAccountDeliveryCount: principalDeliveries.rows[0].count,
    verificationCount: verifications.rows[0].count,
    pointMovementCount: movements.rows[0].count,
    ownerBalance: movements.rows[0].balance,
    persistentScanCount: scans.rowCount,
    scanCategory: scans.rows[0].category,
    scanSource: scans.rows[0].source,
    credentialsPrinted: false,
  }, null, 2));
} finally {
  await Promise.allSettled([pool.end(), auditPool.end()]);
}

