import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDetailedDelivery, createLegacyDelivery, parseDetailedDeliveryInput } from "../artifacts/api-server/src/lib/deliveryDetails.ts";
import { CatalogError, createDraftPoint, createDraftSlot, deactivateCatalogRecord, hasCatalogValidationSchema, parseDraftPoint, parseDraftSlot, updateActiveSlotCapacity, updateDraftPoint, updateDraftSlot, validateCatalogPoint, validateCatalogSlot } from "../artifacts/api-server/src/lib/deliveryCatalog.ts";

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error("TEST_DATABASE_URL is required");
const url = new URL(value);
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55434" || url.pathname !== "/ecopulse_catalog_test") throw new Error("Refusing to test outside isolated catalog PostgreSQL");
const migrationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/db/drizzle");
const adminPool = new pg.Pool({ connectionString: value, max: 12 });
const appPassword = randomBytes(32).toString("hex");
const appUrl = new URL(url);
appUrl.username = "ecopulse_app";
appUrl.password = appPassword;
const appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 8 });
const adminId = "test_catalog_admin";
const participantA = "test_catalog_participant_a";
const participantB = "test_catalog_participant_b";
const reference = "https://example.org/synthetic-catalog-evidence";
async function sqlError(promise, code) { await assert.rejects(promise, error => error?.code === code); }
async function catalogError(promise, code) { await assert.rejects(promise, error => error instanceof CatalogError && error.code === code); }
try {
  await adminPool.query(`CREATE ROLE ecopulse_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await migrate(drizzle(adminPool), { migrationsFolder: migrationRoot });
  const history = await adminPool.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at");
  const hashes = ["0000_core.sql", "0001_delivery_details.sql", "0002_catalog_validation.sql"].map(file => createHash("sha256").update(readFileSync(path.join(migrationRoot, file))).digest("hex"));
  assert.deepEqual(history.rows.map(row => row.hash), hashes);
  assert.equal(await hasCatalogValidationSchema(adminPool), true);
  await adminPool.query(`GRANT CONNECT ON DATABASE ecopulse_catalog_test TO ecopulse_app;
    GRANT USAGE ON SCHEMA public TO ecopulse_app;
    GRANT SELECT ON users, material_categories, delivery_points, delivery_slots, deliveries, delivery_items, delivery_status_events, delivery_idempotency TO ecopulse_app;
    GRANT INSERT (id, code, name, address, municipality, time_zone, appointment_required) ON delivery_points TO ecopulse_app;
    GRANT INSERT (id, delivery_point_id, starts_at, ends_at, capacity) ON delivery_slots TO ecopulse_app;`);
  const privileges = await appPool.query(`SELECT
    has_column_privilege(current_user, 'public.delivery_points', 'name', 'UPDATE') AS point_draft_edit,
    has_column_privilege(current_user, 'public.delivery_points', 'active', 'UPDATE') AS point_publish,
    has_column_privilege(current_user, 'public.delivery_points', 'validated_by', 'UPDATE') AS point_validate,
    has_column_privilege(current_user, 'public.delivery_slots', 'capacity', 'UPDATE') AS slot_draft_edit,
    has_column_privilege(current_user, 'public.delivery_slots', 'active', 'UPDATE') AS slot_publish,
    has_column_privilege(current_user, 'public.delivery_slots', 'validated_by', 'UPDATE') AS slot_validate`);
  assert.deepEqual(privileges.rows[0], { point_draft_edit: true, point_publish: false, point_validate: false, slot_draft_edit: true, slot_publish: false, slot_validate: false });
  const draftForPersistence = await createDraftPoint(appPool, parseDraftPoint({ code: "isolated-min-draft", name: "Synthetic draft", address: "Synthetic address", municipality: "Synthetic municipality", timeZone: "America/Bogota", appointmentRequired: true }));
  const minimalSlot = await createDraftSlot(appPool, parseDraftSlot({ pointId: draftForPersistence.id, startsAt: "2099-02-01T10:00:00Z", endsAt: "2099-02-01T11:00:00Z", capacity: 3 }));
  const separateReader = new pg.Client({ connectionString: appUrl.toString() });
  await separateReader.connect();
  try {
    assert.equal((await separateReader.query("SELECT name FROM delivery_points WHERE id = $1", [draftForPersistence.id])).rows[0].name, "Synthetic draft");
    assert.equal((await separateReader.query("SELECT capacity FROM delivery_slots WHERE id = $1", [minimalSlot.id])).rows[0].capacity, 3);
  } finally { await separateReader.end(); }
  const editedDraft = await updateDraftPoint(appPool, draftForPersistence.id, { name: "Synthetic edited draft", address: "Synthetic address", municipality: "Synthetic municipality", timeZone: "America/Bogota", appointmentRequired: true });
  assert.equal(editedDraft.name, "Synthetic edited draft");
  await sqlError(appPool.query("UPDATE delivery_points SET active = true WHERE id = $1", [draftForPersistence.id]), "42501");
  await sqlError(appPool.query("UPDATE delivery_slots SET active = true WHERE id = $1", [minimalSlot.id]), "42501");
  // Broader grants exist only in this throwaway cluster to exercise future publication guards.
  await adminPool.query(`GRANT UPDATE (validation_reference, validated_by, validated_at, active) ON delivery_points TO ecopulse_app;
    GRANT UPDATE (validation_reference, validated_by, validated_at, active) ON delivery_slots TO ecopulse_app`);
  await adminPool.query("INSERT INTO users (clerk_user_id, role) VALUES ($1, 'admin'), ($2, 'participant'), ($3, 'participant')", [adminId, participantA, participantB]);
  const legacy = await createLegacyDelivery(adminPool, participantA, "catalog_legacy_123");
  assert.equal(legacy.delivery.requestVersion, 1);
  const unscheduled = await createDraftPoint(appPool, parseDraftPoint({ code: "synthetic-no-capacity", name: "Synthetic center without capacity", address: "Synthetic address", municipality: "Synthetic municipality", timeZone: "America/Bogota", appointmentRequired: false }));
  await catalogError(validateCatalogPoint(appPool, unscheduled.id, adminId, reference), "point_validation_conflict");
  const point = await createDraftPoint(appPool, parseDraftPoint({ code: "synthetic-catalog", name: "Synthetic center", address: "Synthetic address", municipality: "Synthetic municipality", timeZone: "America/Bogota", appointmentRequired: true }));
  assert.equal(point.active, false);
  await sqlError(appPool.query("UPDATE delivery_points SET active = true WHERE id = $1", [point.id]), "23514");
  await catalogError(validateCatalogPoint(appPool, point.id, participantA, reference), "catalog_constraint_conflict");
  await adminPool.query("UPDATE delivery_points SET validation_reference = $2 WHERE id = $1", [point.id, reference]);
  const edited = await updateDraftPoint(appPool, point.id, { name: "Synthetic updated center", address: "Synthetic updated address", municipality: "Synthetic municipality", timeZone: "America/Bogota", appointmentRequired: true });
  assert.equal(edited.name, "Synthetic updated center");
  assert.equal((await adminPool.query("SELECT validation_reference FROM delivery_points WHERE id = $1", [point.id])).rows[0].validation_reference, null);
  assert.equal((await validateCatalogPoint(appPool, point.id, adminId, reference)).replayed, false);
  assert.equal((await validateCatalogPoint(appPool, point.id, adminId, reference)).replayed, true);
  await catalogError(validateCatalogPoint(appPool, point.id, adminId, "Different official synthetic reference"), "point_validation_conflict");

  const firstSlot = parseDraftSlot({ pointId: point.id, startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", capacity: 2 });
  const concurrent = await Promise.allSettled([createDraftSlot(appPool, firstSlot), createDraftSlot(appPool, firstSlot)]);
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(item => item.status === "rejected").length, 1);
  const slot = concurrent.find(item => item.status === "fulfilled").value;
  assert.equal(slot.active, false);
  await sqlError(appPool.query("INSERT INTO delivery_slots (id, delivery_point_id, starts_at, ends_at, capacity) VALUES ($1, $2, '2099-01-01T10:30:00Z', '2099-01-01T11:30:00Z', 2)", [randomUUID(), point.id]), "23514");
  await sqlError(appPool.query("UPDATE delivery_slots SET active = true WHERE id = $1", [slot.id]), "23514");
  await catalogError(validateCatalogSlot(appPool, slot.id, participantA, reference), "catalog_constraint_conflict");
  const changedSlot = await updateDraftSlot(appPool, slot.id, { startsAt: new Date("2099-01-01T11:00:00Z"), endsAt: new Date("2099-01-01T12:00:00Z"), capacity: 2 });
  assert.equal(changedSlot.active, false);
  assert.equal((await validateCatalogSlot(appPool, slot.id, adminId, reference)).replayed, false);
  assert.equal((await validateCatalogSlot(appPool, slot.id, adminId, reference)).replayed, true);
  const request = parseDetailedDeliveryInput({ deliveryPointId: point.id, slotId: slot.id, materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] });
  const bookings = await Promise.all([createDetailedDelivery(adminPool, participantA, "catalog_booking_a", request), createDetailedDelivery(adminPool, participantB, "catalog_booking_b", request)]);
  assert.notEqual(bookings[0].delivery.id, bookings[1].delivery.id);
  await assert.rejects(
    createDetailedDelivery(adminPool, participantA, "catalog_booking_over_capacity", request),
    error => error?.code === "delivery_details_conflict" || error?.code === "delivery_slot_unavailable",
  );
  await catalogError(updateActiveSlotCapacity(appPool, slot.id, adminId, 1, reference), "catalog_constraint_conflict");
  await catalogError(deactivateCatalogRecord(appPool, "slots", slot.id), "catalog_constraint_conflict");
  await catalogError(deactivateCatalogRecord(appPool, "points", point.id), "catalog_constraint_conflict");
  const state = await adminPool.query(`SELECT
    (SELECT count(*)::integer FROM delivery_points WHERE active) AS active_points,
    (SELECT count(*)::integer FROM delivery_slots WHERE active) AS active_slots,
    (SELECT count(*)::integer FROM deliveries WHERE request_version = 1) AS legacy_deliveries,
    (SELECT count(*)::integer FROM deliveries WHERE request_version = 2) AS detailed_deliveries,
    (SELECT count(*)::integer FROM point_movements) AS movements,
    (SELECT count(*)::integer FROM verifications) AS verifications`);
  assert.deepEqual(state.rows[0], { active_points: 1, active_slots: 1, legacy_deliveries: 1, detailed_deliveries: 2, movements: 0, verifications: 0 });
  console.log(JSON.stringify({ database: "ecopulse_catalog_test", migrations: 3, hashesVerified: true, draftOnlyInsert: true, publicationRequiresAdminEvidence: true, unscheduledPublicationRejected: true, overCapacityBookingRejected: true, concurrentSlots: "one-created", directOverlapRejected: true, capacityCannotFallBelowReservations: true, outstandingBookingsProtected: true, legacyPreserved: true, syntheticDataOnly: true, mainDatabaseTouched: false, credentialsPrinted: false }, null, 2));
} finally { await Promise.allSettled([appPool.end(), adminPool.end()]); }