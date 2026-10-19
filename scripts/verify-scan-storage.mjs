import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { scanIdForIdempotency } from "../artifacts/api-server/src/lib/pilotPolicy.ts";

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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

async function count(table) {
  const result = await client.query(`SELECT count(*)::integer AS count FROM ${table}`);
  return result.rows[0].count;
}

let baseline;
try {
  baseline = {
    users: await count("users"),
    scans: await count("scans"),
    movements: await count("point_movements"),
  };
  await client.query("BEGIN");

  const userId = `scan_test_${randomUUID()}`;
  const operationKey = `scan_${randomUUID()}`;
  const scanId = scanIdForIdempotency(userId, operationKey);
  await client.query("INSERT INTO users (clerk_user_id) VALUES ($1)", [userId]);

  const first = await client.query(
    "INSERT INTO scans (id, user_id, category, source) VALUES ($1, $2, $3, 'manual') ON CONFLICT (id) DO NOTHING RETURNING id",
    [scanId, userId, "paper"],
  );
  const replay = await client.query(
    "INSERT INTO scans (id, user_id, category, source) VALUES ($1, $2, $3, 'manual') ON CONFLICT (id) DO NOTHING RETURNING id",
    [scanId, userId, "paper"],
  );
  assert.equal(first.rowCount, 1);
  assert.equal(replay.rowCount, 0);

  const stored = await client.query("SELECT category, source FROM scans WHERE id = $1 AND user_id = $2", [scanId, userId]);
  assert.deepEqual(stored.rows, [{ category: "paper", source: "manual" }]);
  assert.equal(await count("point_movements"), baseline.movements);

  await client.query("SAVEPOINT invalid_scan");
  await assert.rejects(
    client.query("INSERT INTO scans (id, user_id, category, source) VALUES ($1, $2, $3, 'automatic')", [randomUUID(), userId, "paper"]),
  );
  await client.query("ROLLBACK TO SAVEPOINT invalid_scan");

  await client.query("ROLLBACK");
  assert.equal(await count("users"), baseline.users);
  assert.equal(await count("scans"), baseline.scans);
  assert.equal(await count("point_movements"), baseline.movements);

  console.log(JSON.stringify({
    database: "ecopulse_dev",
    runtimeRole: "ecopulse_app",
    firstInsert: "created",
    repeatedInsert: "deduplicated",
    storedSource: "manual",
    pointMovementsUnchanged: true,
    invalidSourceRejected: true,
    transactionRolledBack: true,
    persistentRowsUnchanged: true,
    credentialsPrinted: false,
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
