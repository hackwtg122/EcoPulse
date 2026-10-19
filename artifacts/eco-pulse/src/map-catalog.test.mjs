import assert from "node:assert/strict";
import { test } from "node:test";
import { mapAcademicCenters } from "./map-catalog.ts";

const illustrations = [{ id: "eval-01", name: "Académico", zone: "Centro", lat: 8.75, lng: -75.88,
  materials: ["paper"], hours: "09–11", capacity: 20, responsible: "Operador", isTest: true }];

test("eight illustrative markers remain visible without database records", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ ...illustrations[0], id: `eval-0${i + 1}` }));
  const mapped = mapAcademicCenters([], eight);
  assert.equal(mapped.length, 8);
  assert.ok(mapped.every(point => !Object.hasOwn(point, "slots")));
});

test("only a matching database point supplies a reservable slot and UUID", () => {
  const mapped = mapAcademicCenters([{ id: "e1f00101-0001-4000-8000-000000000001", code: "eval-01", name: "Centro académico", address: "Sector académico", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true,
    slots: [{ id: "slot-1", startsAt: "2026-11-02T14:00:00Z", endsAt: "2026-11-02T16:00:00Z", remainingCapacity: 7 }] }], illustrations);
  assert.equal(mapped[0].id, "e1f00101-0001-4000-8000-000000000001");
  assert.equal(mapped[0].slots?.[0].remainingCapacity, 7);
  assert.equal(mapped[0].capacity, 7);
});
