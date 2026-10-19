import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createLegacyDelivery, hasDeliveryDetailsSchema, listUserDeliveries, loadDeliveryOptions } from "../artifacts/api-server/src/lib/deliveryDetails.ts";
import { listCatalog } from "../artifacts/api-server/src/lib/deliveryCatalog.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = path.join(repositoryRoot, "lib", "db", "drizzle");
const stagingRoot = path.join(repositoryRoot, "tmp", "delivery-details-migrations");
const testUrlValue = process.env.TEST_DATABASE_URL;
if (!testUrlValue) throw new Error("TEST_DATABASE_URL is required");
const testUrl = new URL(testUrlValue);
if (
  testUrl.protocol !== "postgresql:" ||
  testUrl.hostname !== "127.0.0.1" ||
  testUrl.port !== "55432" ||
  testUrl.pathname !== "/ecopulse_test"
) {
  throw new Error("Refusing to run outside the isolated PostgreSQL test instance");
}

const normalizedStaging = path.resolve(stagingRoot);
const normalizedTmp = path.resolve(repositoryRoot, "tmp");
if (!normalizedStaging.startsWith(`${normalizedTmp}${path.sep}`)) {
  throw new Error("Unsafe migration staging path");
}
rmSync(normalizedStaging, { recursive: true, force: true });
mkdirSync(path.join(normalizedStaging, "meta"), { recursive: true });

const fullJournal = JSON.parse(readFileSync(path.join(migrationsRoot, "meta", "_journal.json"), "utf8"));
assert.ok(fullJournal.entries.length >= 2, "0000 and 0001 must remain registered");
assert.equal(fullJournal.entries[0].tag, "0000_core");
assert.equal(fullJournal.entries[1].tag, "0001_delivery_details");

function stageJournal(entryCount) {
  writeFileSync(
    path.join(normalizedStaging, "meta", "_journal.json"),
    `${JSON.stringify({ ...fullJournal, entries: fullJournal.entries.slice(0, entryCount) }, null, 2)}\n`,
  );
}

function uuid() {
  return randomUUID();
}

async function expectSqlState(client, label, sql, values, expectedCode) {
  const savepoint = `check_${label.replaceAll(/[^a-z0-9]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(sql, values);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    assert.equal(error?.code, expectedCode, `${label} returned SQLSTATE ${error?.code ?? "unknown"}`);
    return;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert.fail(`${label} unexpectedly succeeded`);
}

const pool = new pg.Pool({ connectionString: testUrlValue, max: 8 });
const db = drizzle(pool);
try {
  cpSync(path.join(migrationsRoot, "0000_core.sql"), path.join(normalizedStaging, "0000_core.sql"));
  stageJournal(1);
  await migrate(db, { migrationsFolder: normalizedStaging });

  const legacyUser = "test_legacy_participant";
  const otherUser = "test_other_participant";
  const legacyScanId = "00000000-0000-4000-8000-000000000101";
  const legacyDeliveryId = "ece719a5-739e-5626-a6b8-727b5dca04ce";
  await pool.query("INSERT INTO users (clerk_user_id) VALUES ($1), ($2)", [legacyUser, otherUser]);
  await pool.query(
    "INSERT INTO scans (id, user_id, category, source) VALUES ($1, $2, 'paper', 'manual')",
    [legacyScanId, legacyUser],
  );
  await pool.query("INSERT INTO deliveries (id, user_id) VALUES ($1, $2)", [legacyDeliveryId, legacyUser]);

  assert.equal(await hasDeliveryDetailsSchema(pool), false);
  const legacyOptions = await loadDeliveryOptions(pool, true);
  assert.deepEqual(legacyOptions, {
    mode: "legacy",
    enabled: true,
    reason: "migration_pending",
    categories: [],
    points: [],
  });
  const preMigrationDeliveries = await listUserDeliveries(pool, legacyUser);
  assert.equal(preMigrationDeliveries.length, 1);
  assert.equal(preMigrationDeliveries[0].id, legacyDeliveryId);
  assert.equal(preMigrationDeliveries[0].requestVersion, 1);
  assert.deepEqual(preMigrationDeliveries[0].materials, []);
  const legacyCreated = await createLegacyDelivery(pool, otherUser, "legacy_backend_compatibility");
  const legacyReplayed = await createLegacyDelivery(pool, otherUser, "legacy_backend_compatibility");
  assert.equal(legacyCreated.replayed, false);
  assert.equal(legacyReplayed.replayed, true);
  assert.equal(legacyCreated.delivery.id, legacyReplayed.delivery.id);
  assert.equal(legacyCreated.delivery.requestVersion, 1);

  cpSync(path.join(migrationsRoot, "0001_delivery_details.sql"), path.join(normalizedStaging, "0001_delivery_details.sql"));
  stageJournal(2);
  await migrate(db, { migrationsFolder: normalizedStaging });

  const history = await pool.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at");
  assert.equal(history.rowCount, 2);
  const expectedHashes = ["0000_core.sql", "0001_delivery_details.sql"].map((file) =>
    createHash("sha256").update(readFileSync(path.join(migrationsRoot, file))).digest("hex"),
  );
  assert.deepEqual(history.rows.map((row) => row.hash), expectedHashes);
  assert.deepEqual(await listCatalog(pool, false), { points: [], slots: [] });

  const legacy = await pool.query(
    "SELECT user_id, status, request_version, delivery_point_id, slot_id, created_at, updated_at FROM deliveries WHERE id = $1",
    [legacyDeliveryId],
  );
  assert.equal(legacy.rowCount, 1);
  assert.equal(legacy.rows[0].user_id, legacyUser);
  assert.equal(legacy.rows[0].status, "pending");
  assert.equal(legacy.rows[0].request_version, 1);
  assert.equal(legacy.rows[0].delivery_point_id, null);
  assert.equal(legacy.rows[0].slot_id, null);
  assert.equal(legacy.rows[0].updated_at.toISOString(), legacy.rows[0].created_at.toISOString());

  const scan = await pool.query("SELECT category, source FROM scans WHERE id = $1 AND user_id = $2", [legacyScanId, legacyUser]);
  assert.deepEqual(scan.rows, [{ category: "paper", source: "manual" }]);

  const categories = await pool.query("SELECT code FROM material_categories ORDER BY code");
  assert.deepEqual(categories.rows.map((row) => row.code), ["glass", "metal", "organic", "other", "paper", "plastic"]);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM delivery_points")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM delivery_slots")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM verifications")).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM point_movements")).rows[0].count, 0);

  const pointId = uuid();
  const secondPointId = uuid();
  const slotId = uuid();
  const secondPointSlotId = uuid();
  const futureStart = "2099-01-15T14:00:00.000Z";
  const futureEnd = "2099-01-15T15:00:00.000Z";
  await pool.query(`
    INSERT INTO delivery_points (id, code, name, address, municipality, time_zone, active)
    VALUES ($1, 'TEST-POINT', 'Synthetic test point', 'Synthetic address', 'Synthetic municipality', 'America/Bogota', true),
           ($2, 'TEST-POINT-2', 'Second synthetic point', 'Synthetic address 2', 'Synthetic municipality', 'America/Bogota', true)
  `, [pointId, secondPointId]);
  await pool.query(`
    INSERT INTO delivery_slots (id, delivery_point_id, starts_at, ends_at, capacity, active)
    VALUES ($1, $2, $3, $4, 1, true), ($5, $6, $3, $4, 1, true)
  `, [slotId, pointId, futureStart, futureEnd, secondPointSlotId, secondPointId]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await expectSqlState(client, "version2_without_point", `
      INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 2)
    `, [uuid(), legacyUser], "23514");
    const invalidGramsDeliveryId = uuid();
    await client.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [invalidGramsDeliveryId, legacyUser, secondPointId, secondPointSlotId]);
    await client.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, NULL, 'pending')
    `, [uuid(), invalidGramsDeliveryId, legacyUser]);
    await expectSqlState(client, "invalid_estimated_grams", `
      INSERT INTO delivery_items (delivery_id, category_code, estimated_grams) VALUES ($1, 'paper', 0)
    `, [invalidGramsDeliveryId], "23514");
    await expectSqlState(client, "legacy_cannot_have_items", `
      INSERT INTO delivery_items (delivery_id, category_code, estimated_grams) VALUES ($1, 'paper', 100)
    `, [legacyDeliveryId], "23514");
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const missingInitialEvent = await pool.connect();
  try {
    const missingInitialEventDeliveryId = uuid();
    await missingInitialEvent.query("BEGIN");
    await missingInitialEvent.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [missingInitialEventDeliveryId, otherUser, secondPointId, secondPointSlotId]);
    await missingInitialEvent.query(`
      INSERT INTO delivery_items (delivery_id, category_code, estimated_grams)
      VALUES ($1, 'metal', 500)
    `, [missingInitialEventDeliveryId]);
    await assert.rejects(
      missingInitialEvent.query("COMMIT"),
      (error) => error?.code === "23514",
      "A detailed delivery without an initial audit event must fail at commit",
    );
    await missingInitialEvent.query("ROLLBACK").catch(() => undefined);
  } finally {
    missingInitialEvent.release();
  }
  const detailedDeliveryId = uuid();
  const initialEventId = uuid();
  const eventId = uuid();
  const keyHash = createHash("sha256").update("synthetic-key").digest("hex");
  const requestHash = createHash("sha256").update("synthetic-request").digest("hex");
  const detailed = await pool.connect();
  try {
    await detailed.query("BEGIN");
    await detailed.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [detailedDeliveryId, legacyUser, pointId, slotId]);
    await detailed.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, NULL, 'pending')
    `, [initialEventId, detailedDeliveryId, legacyUser]);
    await detailed.query(`
      INSERT INTO delivery_items (delivery_id, category_code, estimated_grams)
      VALUES ($1, 'paper', 2500), ($1, 'plastic', 1200)
    `, [detailedDeliveryId]);
    await detailed.query(`
      INSERT INTO delivery_idempotency (user_id, operation, key_hash, request_hash, delivery_id, completed_at)
      VALUES ($1, 'create', $2, $3, $4, now())
    `, [legacyUser, keyHash, requestHash, detailedDeliveryId]);
    await detailed.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, 'pending', 'scheduled')
    `, [eventId, detailedDeliveryId, legacyUser]);
    await detailed.query("UPDATE deliveries SET status = 'scheduled' WHERE id = $1", [detailedDeliveryId]);
    await detailed.query("COMMIT");
  } catch (error) {
    await detailed.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    detailed.release();
  }

  const constraints = await pool.connect();
  try {
    await constraints.query("BEGIN");
    await expectSqlState(constraints, "idempotency_reuse", `
      INSERT INTO delivery_idempotency (user_id, operation, key_hash, request_hash, delivery_id, completed_at)
      VALUES ($1, 'create', $2, $3, $4, now())
    `, [legacyUser, keyHash, createHash("sha256").update("changed-request").digest("hex"), detailedDeliveryId], "23505");
    const storedRequest = await constraints.query(`
      SELECT request_hash FROM delivery_idempotency
      WHERE user_id = $1 AND operation = 'create' AND key_hash = $2
    `, [legacyUser, keyHash]);
    assert.equal(storedRequest.rows[0].request_hash, requestHash);
    await expectSqlState(constraints, "request_version_immutable", `
      UPDATE deliveries
      SET request_version = 1, delivery_point_id = NULL, slot_id = NULL
      WHERE id = $1
    `, [detailedDeliveryId], "55000");
    await expectSqlState(constraints, "items_immutable_after_scheduling", `
      UPDATE delivery_items SET estimated_grams = 3000 WHERE delivery_id = $1 AND category_code = 'paper'
    `, [detailedDeliveryId], "55000");
    await expectSqlState(constraints, "events_append_only", `
      DELETE FROM delivery_status_events WHERE id = $1
    `, [eventId], "55000");
    await expectSqlState(constraints, "slot_point_mismatch", `
      UPDATE deliveries SET delivery_point_id = $2, slot_id = $3 WHERE id = $1
    `, [detailedDeliveryId, secondPointId, slotId], "23514");
    await constraints.query("ROLLBACK");
  } finally {
    constraints.release();
  }

  const missingEvent = await pool.connect();
  try {
    await missingEvent.query("BEGIN");
    await missingEvent.query("UPDATE deliveries SET status = 'received' WHERE id = $1", [detailedDeliveryId]);
    await assert.rejects(
      missingEvent.query("COMMIT"),
      (error) => error?.code === "23514",
      "A status change without an audit event must fail at commit",
    );
    await missingEvent.query("ROLLBACK").catch(() => undefined);
  } finally {
    missingEvent.release();
  }

  const concurrentSlotId = uuid();
  await pool.query(`
    INSERT INTO delivery_slots (id, delivery_point_id, starts_at, ends_at, capacity, active)
    VALUES ($1, $2, '2099-01-16T14:00:00.000Z', '2099-01-16T15:00:00.000Z', 1, true)
  `, [concurrentSlotId, pointId]);
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  const firstDeliveryId = uuid();
  const secondDeliveryId = uuid();
  try {
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    await firstClient.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [firstDeliveryId, legacyUser, pointId, concurrentSlotId]);
    await firstClient.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, NULL, 'pending')
    `, [uuid(), firstDeliveryId, legacyUser]);
    await firstClient.query(`
      INSERT INTO delivery_items (delivery_id, category_code, estimated_grams) VALUES ($1, 'glass', 1000)
    `, [firstDeliveryId]);

    let secondSettled = false;
    const secondInsert = secondClient.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [secondDeliveryId, otherUser, pointId, concurrentSlotId]).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    ).finally(() => { secondSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(secondSettled, false, "The slot row lock must serialize concurrent reservations");
    await firstClient.query("COMMIT");
    const secondResult = await secondInsert;
    assert.equal(secondResult.ok, false);
    assert.equal(secondResult.error?.code, "23514");
    await secondClient.query("ROLLBACK");
  } catch (error) {
    await Promise.allSettled([firstClient.query("ROLLBACK"), secondClient.query("ROLLBACK")]);
    throw error;
  } finally {
    firstClient.release();
    secondClient.release();
  }

  const summary = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM users) AS users,
      (SELECT count(*)::integer FROM scans) AS scans,
      (SELECT count(*)::integer FROM deliveries WHERE request_version = 1) AS legacy_deliveries,
      (SELECT count(*)::integer FROM deliveries WHERE request_version = 2) AS detailed_deliveries,
      (SELECT count(*)::integer FROM verifications) AS verifications,
      (SELECT count(*)::integer FROM point_movements) AS movements
  `);
  assert.deepEqual(summary.rows[0], {
    users: 2,
    scans: 1,
    legacy_deliveries: 2,
    detailed_deliveries: 2,
    verifications: 0,
    movements: 0,
  });

  console.log(JSON.stringify({
    database: "ecopulse_test",
    migrationsAppliedByDrizzle: ["0000_core", "0001_delivery_details"],
    migrationHashesVerified: true,
    legacyCompatibility: true,
    legacyCreateAndReplayBeforeMigration: true,
    materialCategories: categories.rows.map((row) => row.code),
    realDeliveryPointsSeeded: 0,
    realSlotsSeeded: 0,
    estimatedQuantitiesSeparated: true,
    changedPayloadDetectedByStoredHash: true,
    statusHistoryAppendOnly: true,
    initialStatusEventRequired: true,
    requestVersionImmutable: true,
    invalidEstimatedQuantityRejected: true,
    statusChangeRequiresEvent: true,
    concurrentCapacity: "serialized-and-limited",
    syntheticDataOnly: true,
    productionDataTouched: false,
    credentialsPrinted: false,
  }, null, 2));
} finally {
  await pool.end();
  rmSync(normalizedStaging, { recursive: true, force: true });
}
