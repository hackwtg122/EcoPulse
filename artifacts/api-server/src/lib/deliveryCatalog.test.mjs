import assert from "node:assert/strict";
import test from "node:test";
import { canManageCatalog, CatalogError, parseDraftPoint, parseDraftSlot, parsePointEdit, parseSlotEdit, parseValidationReference } from "./deliveryCatalog.ts";

const pointId = "00000000-0000-5000-8000-000000000010";
const point = { code: "centro-prueba", name: "Centro comprobado", address: "Dirección comprobada", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true };
const now = new Date("2026-10-16T00:00:00Z");

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