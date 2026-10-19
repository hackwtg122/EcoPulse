import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { deliveryIdForIdempotency } from "../artifacts/api-server/src/lib/pilotPolicy.ts";

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

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM deliveries) AS deliveries,
      (SELECT count(*)::integer FROM point_movements) AS movements
  `);
  return result.rows[0];
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const baselineClient = await pool.connect();
let baseline;
let users;
try {
  baseline = await counts(baselineClient);
  users = (await baselineClient.query(
    "SELECT clerk_user_id FROM users ORDER BY created_at, clerk_user_id LIMIT 2",
  )).rows.map((row) => row.clerk_user_id);
  assert.equal(users.length, 2, "Two existing development users are required");
} finally {
  baselineClient.release();
}

const sequential = await pool.connect();
try {
  await sequential.query("BEGIN");
  const id = deliveryIdForIdempotency(users[0], `delivery_storage_${randomUUID()}`);
  const first = await sequential.query(
    "INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING RETURNING id, status",
    [id, users[0]],
  );
  const replay = await sequential.query(
    "INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING RETURNING id, status",
    [id, users[0]],
  );
  assert.equal(first.rowCount, 1);
  assert.equal(first.rows[0].status, "pending");
  assert.equal(replay.rowCount, 0);

  const ownerRows = await sequential.query("SELECT id FROM deliveries WHERE id = $1 AND user_id = $2", [id, users[0]]);
  const otherRows = await sequential.query("SELECT id FROM deliveries WHERE id = $1 AND user_id = $2", [id, users[1]]);
  assert.equal(ownerRows.rowCount, 1);
  assert.equal(otherRows.rowCount, 0);
  await sequential.query("ROLLBACK");
} catch (error) {
  await sequential.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  sequential.release();
}

const firstClient = await pool.connect();
const secondClient = await pool.connect();
try {
  const id = deliveryIdForIdempotency(users[0], `delivery_concurrency_${randomUUID()}`);
  await firstClient.query("BEGIN");
  await secondClient.query("BEGIN");
  await firstClient.query(
    "INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING",
    [id, users[0]],
  );

  let secondSettled = false;
  const secondInsert = secondClient.query(
    "INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING RETURNING id",
    [id, users[0]],
  ).then((result) => {
    secondSettled = true;
    return result;
  });
  await delay(150);
  assert.equal(secondSettled, false, "The unique key should serialize concurrent inserts");
  await firstClient.query("ROLLBACK");
  const afterRollback = await secondInsert;
  assert.equal(afterRollback.rowCount, 1);
  await secondClient.query("ROLLBACK");
} catch (error) {
  await Promise.allSettled([
    firstClient.query("ROLLBACK"),
    secondClient.query("ROLLBACK"),
  ]);
  throw error;
} finally {
  firstClient.release();
  secondClient.release();
}

const finalClient = await pool.connect();
try {
  assert.deepEqual(await counts(finalClient), baseline);
} finally {
  finalClient.release();
  await pool.end();
}

console.log(JSON.stringify({
  database: "ecopulse_dev",
  runtimeRole: "ecopulse_app",
  defaultStatus: "pending",
  sequentialReplay: "deduplicated",
  concurrentInsert: "serialized-by-primary-key",
  crossUserLookup: "isolated",
  transactionsRolledBack: true,
  persistentRowsUnchanged: true,
  persistentDeliveryCount: baseline.deliveries,
  pointMovementsUnchanged: true,
  persistentPointMovementCount: baseline.movements,
  credentialsPrinted: false,
}, null, 2));


