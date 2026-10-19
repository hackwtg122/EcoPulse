import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { DeliveryLifecycleError, receivePhysicalDelivery, verifyPhysicalDelivery } from "../artifacts/api-server/src/lib/deliveryLifecycle.ts";
import { createDraftPoint, createDraftSlot, parseDraftPoint, parseDraftSlot } from "../artifacts/api-server/src/lib/deliveryCatalog.ts";
import {
  createDetailedDelivery,
  DeliveryRequestError,
  hashDeliveryIdempotencyKey,
  hasDeliveryDetailsSchema,
  listUserDeliveries,
  listVerifierDeliveries,
  loadDeliveryOptions,
  parseDetailedDeliveryInput,
} from "../artifacts/api-server/src/lib/deliveryDetails.ts";

const testUrlValue = process.env.TEST_DATABASE_URL;
if (!testUrlValue) throw new Error("TEST_DATABASE_URL is required");
const testUrl = new URL(testUrlValue);
if (testUrl.hostname !== "127.0.0.1" || testUrl.port !== "55432" || testUrl.pathname !== "/ecopulse_test") {
  throw new Error("Refusing to test the backend outside isolated ecopulse_test");
}

const adminPool = new pg.Pool({ connectionString: testUrlValue, max: 12 });
const applicationPassword = randomBytes(32).toString("hex");
const applicationUrl = new URL(testUrl);
applicationUrl.username = "ecopulse_test_app";
applicationUrl.password = applicationPassword;
const applicationPool = new pg.Pool({ connectionString: applicationUrl.toString(), max: 12 });
const ownerUser = "test_legacy_participant";
const otherUser = "test_other_participant";

async function expectDeliveryError(promise, expectedCode) {
  await assert.rejects(
    promise,
    (error) => error instanceof DeliveryRequestError && error.code === expectedCode,
    `Expected DeliveryRequestError ${expectedCode}`,
  );
}

try {
  await adminPool.query(`
    CREATE ROLE ecopulse_test_app LOGIN PASSWORD '${applicationPassword}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    REVOKE ALL ON DATABASE ecopulse_test FROM ecopulse_test_app;
    GRANT CONNECT ON DATABASE ecopulse_test TO ecopulse_test_app;
    REVOKE ALL ON SCHEMA public FROM ecopulse_test_app;
    GRANT USAGE ON SCHEMA public TO ecopulse_test_app;
    GRANT SELECT ON material_categories, delivery_points, delivery_slots, deliveries,
      delivery_items, delivery_status_events, delivery_idempotency TO ecopulse_test_app;
    GRANT INSERT ON deliveries, delivery_items, delivery_status_events, delivery_idempotency TO ecopulse_test_app;
    GRANT UPDATE (delivery_id, completed_at) ON delivery_idempotency TO ecopulse_test_app;
    GRANT INSERT (id, code, name, address, municipality, time_zone, appointment_required) ON delivery_points TO ecopulse_test_app;
    GRANT INSERT (id, delivery_point_id, starts_at, ends_at, capacity) ON delivery_slots TO ecopulse_test_app;
  `);

  const draft = await createDraftPoint(applicationPool, parseDraftPoint({
    code: "isolated-draft", name: "Synthetic draft center", address: "Synthetic address",
    municipality: "Synthetic municipality", timeZone: "America/Bogota", appointmentRequired: true,
  }));
  assert.equal(draft.active, false);
  const draftSlotInput = parseDraftSlot({
    pointId: draft.id, startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", capacity: 1,
  });
  const concurrentDrafts = await Promise.allSettled([
    createDraftSlot(applicationPool, draftSlotInput), createDraftSlot(applicationPool, draftSlotInput),
  ]);
  assert.equal(concurrentDrafts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(concurrentDrafts.filter(result => result.status === "rejected").length, 1);
  assert.equal(concurrentDrafts.find(result => result.status === "fulfilled").value.active, false);
  const draftRows = await adminPool.query("SELECT count(*)::integer AS count FROM delivery_slots WHERE delivery_point_id = $1", [draft.id]);
  assert.equal(draftRows.rows[0].count, 1);
  await assert.rejects(applicationPool.query(`INSERT INTO delivery_points (id, code, name, address, municipality, time_zone, appointment_required, active) VALUES ($1, 'forbidden-active', 'Synthetic', 'Synthetic', 'Synthetic', 'America/Bogota', true, true)`, [randomUUID()]), error => error.code === "42501");
  const pointId = randomUUID();
  const inactivePointId = randomUUID();
  const retrySlotId = randomUUID();
  const rollbackSlotId = randomUUID();
  const capacitySlotId = randomUUID();
  await adminPool.query(`
    INSERT INTO delivery_points (id, code, name, address, municipality, time_zone, appointment_required, active)
    VALUES
      ($1, 'BACKEND-TEST', 'Synthetic backend point', 'Synthetic test address', 'Synthetic municipality', 'America/Bogota', true, true),
      ($2, 'BACKEND-INACTIVE', 'Inactive synthetic point', 'Synthetic inactive address', 'Synthetic municipality', 'America/Bogota', false, false)
  `, [pointId, inactivePointId]);
  await adminPool.query(`
    INSERT INTO delivery_slots (id, delivery_point_id, starts_at, ends_at, capacity, active)
    VALUES
      ($1, $4, '2099-02-01T14:00:00Z', '2099-02-01T15:00:00Z', 4, true),
      ($2, $4, '2099-02-02T14:00:00Z', '2099-02-02T15:00:00Z', 4, true),
      ($3, $4, '2099-02-03T14:00:00Z', '2099-02-03T15:00:00Z', 1, true)
  `, [retrySlotId, rollbackSlotId, capacitySlotId, pointId]);

  assert.equal(await hasDeliveryDetailsSchema(applicationPool), true);
  const options = await loadDeliveryOptions(applicationPool, true);
  assert.equal(options.mode, "detailed");
  assert.equal(options.enabled, true);
  const backendPoint = options.points.find((point) => point.id === pointId);
  assert.ok(backendPoint);
  assert.equal(backendPoint.slots.length, 3);

  const retryInput = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId: retrySlotId,
    materials: [{ categoryCode: "paper", estimatedGrams: 2400 }, { categoryCode: "plastic", estimatedGrams: 1100 }],
  });
  const sameKeyResults = await Promise.all([
    createDetailedDelivery(applicationPool, ownerUser, "backend_same_key_123", retryInput),
    createDetailedDelivery(applicationPool, ownerUser, "backend_same_key_123", retryInput),
  ]);
  assert.equal(sameKeyResults[0].delivery.id, sameKeyResults[1].delivery.id);
  assert.deepEqual(sameKeyResults.map((result) => result.replayed).sort(), [false, true]);

  const changedInput = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId: retrySlotId,
    materials: [{ categoryCode: "paper", estimatedGrams: 2500 }, { categoryCode: "plastic", estimatedGrams: 1100 }],
  });
  await expectDeliveryError(
    createDetailedDelivery(applicationPool, ownerUser, "backend_same_key_123", changedInput),
    "idempotency_key_reused",
  );

  const ownerHistory = await listUserDeliveries(applicationPool, ownerUser);
  const otherHistoryBeforeCapacity = await listUserDeliveries(applicationPool, otherUser);
  assert.ok(ownerHistory.some((delivery) => delivery.id === sameKeyResults[0].delivery.id && delivery.requestVersion === 2));
  assert.ok(otherHistoryBeforeCapacity.every((delivery) => delivery.id !== sameKeyResults[0].delivery.id));
  assert.ok(ownerHistory.some((delivery) => delivery.requestVersion === 1));
  const otherVerifierQueue = await listVerifierDeliveries(applicationPool, otherUser, 20, null);
  const ownerVerifierQueue = await listVerifierDeliveries(applicationPool, ownerUser, 20, null);
  assert.ok(otherVerifierQueue.some((delivery) => delivery.id === sameKeyResults[0].delivery.id));
  assert.ok(ownerVerifierQueue.every((delivery) => delivery.id !== sameKeyResults[0].delivery.id));

  const scheduledClient = await adminPool.connect();
  try {
    await scheduledClient.query("BEGIN");
    await scheduledClient.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, 'pending', 'scheduled')
    `, [randomUUID(), sameKeyResults[0].delivery.id, ownerUser]);
    await scheduledClient.query("UPDATE deliveries SET status = 'scheduled' WHERE id = $1", [sameKeyResults[0].delivery.id]);
    await scheduledClient.query("COMMIT");
  } catch (error) {
    await scheduledClient.query("ROLLBACK");
    throw error;
  } finally {
    scheduledClient.release();
  }
  const scheduledQueue = await listVerifierDeliveries(applicationPool, otherUser, 20, null);
  assert.ok(scheduledQueue.some((delivery) => delivery.id === sameKeyResults[0].delivery.id && delivery.status === "scheduled"));

  const rollbackInput = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId: rollbackSlotId,
    materials: [{ categoryCode: "metal", estimatedGrams: 900 }],
  });
  const rollbackKey = "backend_rollback_123";
  await assert.rejects(
    createDetailedDelivery(applicationPool, ownerUser, rollbackKey, rollbackInput, {
      beforeCommit: async () => { throw new Error("synthetic_transaction_failure"); },
    }),
    /synthetic_transaction_failure/,
  );
  const rollbackState = await adminPool.query(`
    SELECT
      (SELECT count(*)::integer FROM delivery_idempotency WHERE user_id = $1 AND key_hash = $2) AS idempotency_rows,
      (SELECT count(*)::integer FROM deliveries WHERE slot_id = $3) AS delivery_rows
  `, [ownerUser, hashDeliveryIdempotencyKey(rollbackKey), rollbackSlotId]);
  assert.deepEqual(rollbackState.rows[0], { idempotency_rows: 0, delivery_rows: 0 });

  const capacityInputOwner = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId: capacitySlotId,
    materials: [{ categoryCode: "glass", estimatedGrams: 800 }],
  });
  const capacityInputOther = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId: capacitySlotId,
    materials: [{ categoryCode: "metal", estimatedGrams: 700 }],
  });
  const capacityResults = await Promise.allSettled([
    createDetailedDelivery(applicationPool, ownerUser, "backend_capacity_owner", capacityInputOwner),
    createDetailedDelivery(applicationPool, otherUser, "backend_capacity_other", capacityInputOther),
  ]);
  assert.equal(capacityResults.filter((result) => result.status === "fulfilled").length, 1);
  const rejectedCapacity = capacityResults.find((result) => result.status === "rejected");
  assert.ok(rejectedCapacity && rejectedCapacity.status === "rejected");
  assert.ok(rejectedCapacity.reason instanceof DeliveryRequestError);
  assert.ok(["delivery_slot_unavailable", "delivery_details_conflict"].includes(rejectedCapacity.reason.code));

  const inactiveInput = parseDetailedDeliveryInput({
    deliveryPointId: inactivePointId,
    slotId: null,
    materials: [{ categoryCode: "paper", estimatedGrams: 1000 }],
  });
  await expectDeliveryError(
    createDetailedDelivery(applicationPool, ownerUser, "backend_inactive_point", inactiveInput),
    "delivery_point_unavailable",
  );

  await assert.rejects(
    applicationPool.query("CREATE TABLE forbidden_runtime_ddl (id integer)"),
    (error) => error?.code === "42501",
  );
  await assert.rejects(
    applicationPool.query("DELETE FROM deliveries WHERE id = $1", [sameKeyResults[0].delivery.id]),
    (error) => error?.code === "42501",
  );
  await assert.rejects(
    applicationPool.query("UPDATE delivery_status_events SET reason_code = 'changed' WHERE delivery_id = $1", [sameKeyResults[0].delivery.id]),
    (error) => error?.code === "42501",
  );

  const security = await adminPool.query(`
    SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
      has_schema_privilege('ecopulse_test_app', 'public', 'CREATE') AS schema_create,
      has_table_privilege('ecopulse_test_app', 'delivery_status_events', 'UPDATE') AS events_update,
      has_table_privilege('ecopulse_test_app', 'deliveries', 'DELETE') AS deliveries_delete
    FROM pg_roles WHERE rolname = 'ecopulse_test_app'
  `);
  assert.deepEqual(security.rows[0], {
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    schema_create: false,
    events_update: false,
    deliveries_delete: false,
  });

  const protectedState = await adminPool.query(`
    SELECT
      (SELECT count(*)::integer FROM verifications) AS verifications,
      (SELECT count(*)::integer FROM point_movements) AS point_movements,
      (SELECT count(*)::integer FROM deliveries WHERE slot_id = $1) AS capacity_reservations
  `, [capacitySlotId]);
  assert.deepEqual(protectedState.rows[0], { verifications: 0, point_movements: 0, capacity_reservations: 1 });

  // These grants exist only on the disposable PostgreSQL cluster.
  await adminPool.query(`
    GRANT UPDATE (status) ON deliveries TO ecopulse_test_app;
    GRANT SELECT, INSERT ON verifications TO ecopulse_test_app;
    GRANT SELECT, INSERT ON point_movements TO ecopulse_test_app;
  `);
  const lifecycleDeliveryId = sameKeyResults[0].delivery.id;
  await assert.rejects(
    receivePhysicalDelivery(applicationPool, ownerUser, "verifier", lifecycleDeliveryId),
    (error) => error instanceof DeliveryLifecycleError && error.code === "self_verification_forbidden",
  );
  await assert.rejects(
    receivePhysicalDelivery(applicationPool, otherUser, "participant", lifecycleDeliveryId),
    (error) => error instanceof DeliveryLifecycleError && error.code === "verifier_required",
  );
  await assert.rejects(
    verifyPhysicalDelivery(applicationPool, otherUser, "verifier", lifecycleDeliveryId, "approved", 3500, "SYNTHETIC-RECEIPT-1", 10),
    (error) => error instanceof DeliveryLifecycleError && error.code === "physical_receipt_required",
  );
  const receiveResults = await Promise.all([
    receivePhysicalDelivery(applicationPool, otherUser, "verifier", lifecycleDeliveryId),
    receivePhysicalDelivery(applicationPool, otherUser, "verifier", lifecycleDeliveryId),
  ]);
  assert.deepEqual(receiveResults.map((result) => result.replayed).sort(), [false, true]);
  const verificationResults = await Promise.all([
    verifyPhysicalDelivery(applicationPool, otherUser, "verifier", lifecycleDeliveryId, "approved", 3500, "SYNTHETIC-RECEIPT-1", 10, null, 30),
    verifyPhysicalDelivery(applicationPool, otherUser, "verifier", lifecycleDeliveryId, "approved", 3500, "SYNTHETIC-RECEIPT-1", 10, null, 30),
  ]);
  assert.deepEqual(verificationResults.map((result) => result.replayed).sort(), [false, true]);
  assert.ok(verificationResults.every((result) => result.points === 30));
  await assert.rejects(
    verifyPhysicalDelivery(applicationPool, otherUser, "verifier", lifecycleDeliveryId, "approved", 3501, "SYNTHETIC-RECEIPT-1", 10),
    (error) => error instanceof DeliveryLifecycleError && error.code === "already_verified",
  );
  const lifecycleState = await adminPool.query(`
    SELECT
      (SELECT status::text FROM deliveries WHERE id = $1) AS status,
      (SELECT count(*)::integer FROM verifications WHERE delivery_id = $1) AS verifications,
      (SELECT count(*)::integer FROM delivery_status_events WHERE delivery_id = $1) AS events,
      (SELECT count(*)::integer FROM point_movements WHERE user_id = $2) AS movements,
      (SELECT coalesce(sum(delta), 0)::integer FROM point_movements WHERE user_id = $2) AS balance,
      (SELECT count(*)::integer FROM point_movements WHERE user_id = $3) AS other_movements
  `, [lifecycleDeliveryId, ownerUser, otherUser]);
  assert.deepEqual(lifecycleState.rows[0], {
    status: "approved", verifications: 1, events: 4, movements: 1, balance: 30, other_movements: 0,
  });
  const policyAudit = await adminPool.query("SELECT reason_code FROM delivery_status_events WHERE delivery_id = $1 AND to_status = 'approved'", [lifecycleDeliveryId]);
  assert.deepEqual(policyAudit.rows, [{ reason_code: "points_rate_10_cap_30" }]);
  const rejectedDelivery = await createDetailedDelivery(applicationPool, ownerUser, "backend_reject_after_receipt", rollbackInput);
  await receivePhysicalDelivery(applicationPool, otherUser, "verifier", rejectedDelivery.delivery.id);
  const rejected = await verifyPhysicalDelivery(applicationPool, otherUser, "verifier", rejectedDelivery.delivery.id, "rejected", null, null, null, "contaminated");
  const rejectedReplay = await verifyPhysicalDelivery(applicationPool, otherUser, "verifier", rejectedDelivery.delivery.id, "rejected", null, null, null, "contaminated");
  assert.equal(rejected.replayed, false);
  assert.equal(rejectedReplay.replayed, true);
  assert.equal(rejected.points, 0);
  await assert.rejects(
    verifyPhysicalDelivery(applicationPool, otherUser, "verifier", rejectedDelivery.delivery.id, "rejected", null, null, null, "material_mismatch"),
    error => error instanceof DeliveryLifecycleError && error.code === "already_verified",
  );
  const rejectionAudit = await adminPool.query("SELECT reason_code FROM delivery_status_events WHERE delivery_id = $1 AND to_status = 'rejected'", [rejectedDelivery.delivery.id]);
  assert.deepEqual(rejectionAudit.rows, [{ reason_code: "contaminated" }]);
  await assert.rejects(applicationPool.query("UPDATE point_movements SET delta = 999 WHERE user_id = $1", [ownerUser]), error => error?.code === "42501");
  const finalMovements = await adminPool.query("SELECT count(*)::integer AS count FROM point_movements");
  assert.equal(finalMovements.rows[0].count, 1);

  console.log(JSON.stringify({
    backend: "detailed-delivery-service",
    schemaGate: "verified",
    stagedActivation: "verified",
    leastPrivilegeRole: "verified-in-isolated-database",
    draftCatalog: "one-inactive-center-one-inactive-slot-overlap-rejected",
    sameKeyConcurrentRetries: "one-created-one-replayed",
    changedPayloadReuse: "rejected",
    transactionRollback: "no-partial-rows",
    multiuserIsolation: "verified",
    concurrentCapacity: "one-reservation",
    inactivePoint: "rejected",
    verificationsCreated: 0,
    pointMovementsCreatedBeforeSyntheticLifecycle: 0,
    syntheticPhysicalLifecycle: "receipt-then-one-verification-one-movement-and-one-rejection",
    cappedPolicy: "verified",
    rejectionReasonAudited: true,
    credentialsPrinted: false,
  }, null, 2));
} finally {
  await Promise.allSettled([applicationPool.end(), adminPool.end()]);
}
