import assert from "node:assert/strict";
import test from "node:test";
import { canManageCatalog, CatalogError, listCatalog, parseDraftPoint, parseDraftSlot, parsePointCoordinates, parsePointMaterials, parsePointEdit, parseSlotEdit, parseValidationReference, replaceDraftPointMaterials, validateCatalogPoint, validateCatalogSlot } from "./deliveryCatalog.ts";

const pointId = "00000000-0000-5000-8000-000000000010";
const point = { code: "centro-prueba", name: "Centro comprobado", address: "Dirección comprobada", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true };
const now = new Date("2026-10-16T00:00:00Z");
test("administrative status distinguishes legacy active records from operational validation without rewriting them", async () => {
  const legacy = { id: pointId, active: true, validationReference: "academic:ecopulse/old", validatedAt: new Date(), validatedBy: "user_Admin" };
  const valid = { ...legacy, validationReference: "https://example.org/authorization" };
  const catalog = await listCatalog({ async query() { return { rows: [legacy, valid] }; } }, true);
  for (const collection of [catalog.points, catalog.slots]) {
    assert.equal(collection[0].operationallyValidated, false);
    assert.equal(collection[0].active, true);
    assert.equal(collection[0].validationReference, legacy.validationReference);
    assert.equal(collection[1].operationallyValidated, true);
    assert.ok(!("validatedBy" in collection[1]));
  }
});
test("a slot cannot be published against an unvalidated legacy parent", async () => {
  const queries = [];
  const pool = { async connect() { return { release() {}, async query(sql) {
    queries.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("SELECT role")) return { rows: [{ role: "admin" }] };
    if (sql.startsWith("SELECT p.active")) return { rows: [{ active: true, validation_reference: "academic:ecopulse/old", validated_at: new Date(), validated_by: "user_Admin" }] };
    throw Error("Unexpected SQL " + sql);
  } }; } };
  await assert.rejects(validateCatalogSlot(pool, pointId, "user_Admin", "https://example.org/slot"), { code: "parent_center_unvalidated" });
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.some(sql => sql.startsWith("UPDATE")));
});
test("center publication rolls back when no accepted active material is configured", async () => {
  const queries = [];
  const pool = { async connect() { return { release() {}, async query(sql) {
    queries.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("SELECT role")) return { rows: [{ role: "admin" }] };
    if (sql.startsWith("UPDATE delivery_points")) return { rows: [{ id: pointId }], rowCount: 1 };
    if (sql.startsWith("SELECT EXISTS")) return { rows: [{ ready: false }] };
    throw Error("Unexpected SQL " + sql);
  } }; } };
  await assert.rejects(validateCatalogPoint(pool, pointId, "user_Admin", "https://example.org/point"), { code: "point_materials_required" });
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.includes("COMMIT"));
});

test("coordinates and accepted materials reject invalid or extra data", () => {
  assert.deepEqual(parsePointCoordinates({ latitude: 8.75, longitude: -75.88 }), { latitude: 8.75, longitude: -75.88 });
  assert.deepEqual(parsePointCoordinates({ latitude: null, longitude: null }), { latitude: null, longitude: null });
  for (const value of [{ latitude: 91, longitude: 1 }, { latitude: 1, longitude: null }, { latitude: 1, longitude: 2, active: true }]) {
    assert.throws(() => parsePointCoordinates(value), error => error instanceof CatalogError && error.status === 400);
  }
  assert.deepEqual(parsePointMaterials({ materials: ["paper", "plastic"] }), ["paper", "plastic"]);
  for (const materials of [["paper", "paper"], ["unknown"], [1]]) assert.throws(() => parsePointMaterials({ materials }), error => error instanceof CatalogError);
});

test("material changes lock drafts and roll back when categories are unavailable", async () => {
  const queries = [];
  const client = { release() {}, async query(sql) {
    queries.push(sql);
    if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
    if (sql.startsWith("SELECT role FROM users")) return { rows: [{ role: "admin" }] };
    if (sql.startsWith("SELECT id FROM delivery_points")) return { rowCount: 1, rows: [{ id: pointId }] };
    if (sql.startsWith("SELECT code FROM material_categories")) return { rowCount: 0, rows: [] };
    throw Error("unexpected_query");
  } };
  await assert.rejects(replaceDraftPointMaterials({ connect: async () => client }, "user_TestAdmin", pointId, ["paper"]), error => error.code === "material_category_unavailable");
  assert.ok(queries.some(sql => sql.includes("active=false FOR UPDATE")));
  assert.ok(!queries.some(sql => sql.startsWith("DELETE")));
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("publishing a walk-in center does not incorrectly require appointment_required=true", async () => {
  const result = await validateCatalogPoint({ async connect() { return { release() {}, async query(text, params) {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
    if (text.startsWith("SELECT role FROM users")) return { rows: [{ role: "admin" }] };
    if (text.startsWith("SELECT EXISTS")) return { rows: [{ ready: true }] };
    assert.ok(text.includes("active = false"));
    assert.ok(!text.includes("appointment_required = true"));
    assert.deepEqual(params, [pointId, "user_TestAdmin", "https://example.org/test-evidence"]);
    return { rowCount: 1, rows: [{ id: pointId, active: true }] };
  } }; } }, pointId, "user_TestAdmin", "https://example.org/test-evidence");
  assert.equal(result.replayed, false);
});

test("draft center validation excludes activation, roles and arbitrary fields", () => {
  assert.deepEqual(parseDraftPoint(point), point);
  for (const bad of [
    { ...point, active: true }, { ...point, role: "admin" }, { ...point, code: "ABC" },
    { ...point, name: " Centro" }, { ...point, timeZone: "UTC" }, { ...point, appointmentRequired: "true" },
  ]) assert.throws(() => parseDraftPoint(bad), error => error instanceof CatalogError && error.status === 400);
});

test("draft slots require explicit future offsets and bounded capacity", () => {
  const slot = { pointId, startsAt: "2026-10-20T09:00:00-05:00", endsAt: "2026-10-20T10:00:00-05:00", capacity: 2 };
  const parsed = parseDraftSlot(slot, now);
  assert.equal(parsed.startsAt.toISOString(), "2026-10-20T14:00:00.000Z");
  for (const bad of [
    { ...slot, active: true }, { ...slot, pointId: "other" }, { ...slot, startsAt: "2026-10-20T09:00" },
    { ...slot, endsAt: "2026-10-20T08:00:00-05:00" }, { ...slot, endsAt: "2026-10-21T09:00:00-05:00" },
    { ...slot, capacity: 0 }, { ...slot, capacity: 1001 }, { ...slot, capacity: 1.5 },
  ]) assert.throws(() => parseDraftSlot(bad, now), error => error instanceof CatalogError && error.status === 400);
});
test("catalog management is server restricted to the admin role", () => {
  assert.equal(canManageCatalog("admin"), true);
  for (const role of ["participant", "verifier", undefined, null, { role: "admin" }]) {
    assert.equal(canManageCatalog(role), false);
  }
});
test("draft edits cannot set identity, activation or validator fields", () => {
  assert.equal(parsePointEdit({ name: "Centro comprobado", address: "Dirección comprobada", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true }).name, "Centro comprobado");
  assert.throws(() => parsePointEdit({ name: "Centro comprobado", address: "Dirección comprobada", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true, active: true }), error => error instanceof CatalogError && error.code === "unexpected_fields");
  assert.equal(parseSlotEdit({ startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", capacity: 2 }).capacity, 2);
  assert.throws(() => parseSlotEdit({ startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", capacity: 2, validatedBy: "user" }), error => error instanceof CatalogError && error.code === "unexpected_fields");
});

test("publication requires a bounded evidence reference, not client-supplied actor", () => {
  const evidence = "https://example.org/synthetic-evidence";
  assert.equal(parseValidationReference({ validationReference: evidence }), evidence);
  for (const bad of [
    { validationReference: "" }, { validationReference: "   " },
    { validationReference: "Official document 2026" },
    { validationReference: "http://example.org/evidence" },
    { validationReference: "https://localhost/evidence" },
    { validationReference: "https://127.0.0.1/evidence" },
    { validationReference: "https://user:password@example.org/evidence" },
    { validationReference: evidence, validatedBy: "other" },
  ]) {
    assert.throws(() => parseValidationReference(bad), error => error instanceof CatalogError && error.status === 400);
  }
});
