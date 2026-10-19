import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

const migrationUrl = new URL(process.env.MIGRATION_DATABASE_URL);
if (
  migrationUrl.protocol !== "postgresql:" ||
  migrationUrl.hostname !== "127.0.0.1" ||
  migrationUrl.port !== "5432" ||
  decodeURIComponent(migrationUrl.username) !== "ecopulse_migrator" ||
  migrationUrl.pathname !== "/ecopulse_dev"
) {
  throw new Error("MIGRATION_DATABASE_URL does not point to the expected local development database");
}

const tableNames = ["users", "scans", "deliveries", "verifications", "point_movements", "rewards", "redemptions"];
const pool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });

async function rowCounts(client) {
  const counts = {};
  for (const table of tableNames) {
    const result = await client.query(`SELECT count(*)::integer AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

function assertOnlyOwner(rows, ownerId) {
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.user_id === ownerId));
}

const client = await pool.connect();
let baseline;

try {
  baseline = await rowCounts(client);
  await client.query("BEGIN");

  const userA = `security_a_${randomUUID()}`;
  const userB = `security_b_${randomUUID()}`;
  const scanA = randomUUID();
  const scanB = randomUUID();
  const deliveryA = randomUUID();
  const deliveryB = randomUUID();
  const verificationA = randomUUID();
  const verificationB = randomUUID();
  const reward = randomUUID();
  const redemptionA = randomUUID();
  const redemptionB = randomUUID();

  await client.query("INSERT INTO users (clerk_user_id) VALUES ($1), ($2)", [userA, userB]);
  await client.query(`INSERT INTO scans (id, user_id, category, source) VALUES
    ($1, $2, 'paper', 'manual'), ($3, $4, 'glass', 'manual')`, [scanA, userA, scanB, userB]);
  await client.query("INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 1), ($3, $4, 1)", [deliveryA, userA, deliveryB, userB]);
  await client.query(`INSERT INTO verifications
    (id, delivery_id, verifier_id, decision, verified_grams, receipt_code) VALUES
    ($1, $2, $3, 'approved', 1000, 'SECURITYA1'),
    ($4, $5, $6, 'approved', 2000, 'SECURITYB1')`,
    [verificationA, deliveryA, userB, verificationB, deliveryB, userA]);
  await client.query(`INSERT INTO point_movements (id, user_id, delta, kind, source_id) VALUES
    ($1, $2, 10, 'delivery', $3), ($4, $5, 20, 'delivery', $6)`,
    [randomUUID(), userA, verificationA, randomUUID(), userB, verificationB]);
  await client.query("INSERT INTO rewards (id, title, description, cost, active) VALUES ($1, 'Security test', 'Rolled back', 5, false)", [reward]);
  await client.query(`INSERT INTO redemptions (id, user_id, reward_id, cost, idempotency_key) VALUES
    ($1, $2, $3, 5, 'security-key-a'), ($4, $5, $3, 5, 'security-key-b')`,
    [redemptionA, userA, reward, redemptionB, userB]);
  await client.query(`INSERT INTO point_movements (id, user_id, delta, kind, source_id) VALUES
    ($1, $2, -5, 'redemption', $3), ($4, $5, -5, 'redemption', $6)`,
    [randomUUID(), userA, redemptionA, randomUUID(), userB, redemptionB]);

  for (const actor of [userA, userB]) {
    const scans = await client.query("SELECT id, user_id FROM scans WHERE user_id = $1", [actor]);
    const deliveries = await client.query("SELECT id, user_id FROM deliveries WHERE user_id = $1", [actor]);
    const movements = await client.query("SELECT id, user_id FROM point_movements WHERE user_id = $1", [actor]);
    const redemptions = await client.query("SELECT id, user_id FROM redemptions WHERE user_id = $1", [actor]);
    assertOnlyOwner(scans.rows, actor);
    assertOnlyOwner(deliveries.rows, actor);
    assertOnlyOwner(movements.rows, actor);
    assertOnlyOwner(redemptions.rows, actor);
  }

  const balanceA = await client.query("SELECT coalesce(sum(delta), 0)::integer AS balance FROM point_movements WHERE user_id = $1", [userA]);
  const balanceB = await client.query("SELECT coalesce(sum(delta), 0)::integer AS balance FROM point_movements WHERE user_id = $1", [userB]);
  assert.equal(balanceA.rows[0].balance, 5);
  assert.equal(balanceB.rows[0].balance, 15);

  await client.query("ROLLBACK");
  const final = await rowCounts(client);
  assert.deepEqual(final, baseline);

  console.log(JSON.stringify({
    database: "ecopulse_dev",
    syntheticUsers: 2,
    isolatedResources: ["scans", "deliveries", "point_movements", "redemptions", "balance"],
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
