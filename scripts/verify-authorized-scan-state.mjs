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
) throw new Error("DATABASE_URL does not point to the expected local development database and runtime role");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const scans = await pool.query("SELECT id, user_id, category, source FROM scans ORDER BY created_at ASC");
  assert.equal(scans.rowCount, 1, "Expected exactly one persistent scan");
  const [scan] = scans.rows;
  assert.equal(scan.category, "paper");
  assert.equal(scan.source, "manual");

  const state = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM users WHERE clerk_user_id <> $1) AS other_users,
       (SELECT count(*)::integer FROM scans WHERE user_id = $1) AS owner_scans,
       (SELECT count(*)::integer FROM scans WHERE user_id <> $1) AS other_user_scans,
       (SELECT count(*)::integer FROM deliveries WHERE user_id = $1) AS owner_deliveries,
       (SELECT count(*)::integer FROM point_movements WHERE user_id = $1) AS owner_movements,
       (SELECT coalesce(sum(delta), 0)::integer FROM point_movements WHERE user_id = $1) AS owner_balance,
       (SELECT count(*)::integer FROM point_movements WHERE source_id = $2) AS scan_movements`,
    [scan.user_id, scan.id],
  );
  const result = state.rows[0];
  assert.ok(result.other_users >= 1, "Expected another Clerk-backed user for isolation verification");
  assert.equal(result.owner_scans, 1);
  assert.equal(result.other_user_scans, 0);
  assert.equal(result.owner_deliveries, 1, "The existing pending delivery belongs to the scan owner");
  assert.equal(result.owner_movements, 0);
  assert.equal(result.owner_balance, 0);
  assert.equal(result.scan_movements, 0);

  console.log(JSON.stringify({
    database: "ecopulse_dev",
    runtimeRole: "ecopulse_app",
    totalPersistentScans: scans.rowCount,
    category: scan.category,
    source: scan.source,
    ownerScanCount: result.owner_scans,
    otherUserScanCount: result.other_user_scans,
    ownerDeliveryCount: result.owner_deliveries,
    ownerPointMovementCount: result.owner_movements,
    ownerBalance: result.owner_balance,
    scanPointMovementCount: result.scan_movements,
    credentialsPrinted: false,
  }, null, 2));
} finally {
  await pool.end();
}
