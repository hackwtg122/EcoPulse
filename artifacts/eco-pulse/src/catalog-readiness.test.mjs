import assert from "node:assert/strict";
import test from "node:test";
import { centerRequirements } from "./catalog-readiness.ts";
const point = { id: "center", active: true, appointmentRequired: true, operationallyValidated: true };
const materials = [{ pointId: "center", code: "paper" }];
const slot = { pointId: "center", active: true, operationallyValidated: true, startsAt: "2099-01-01T10:00:00Z", remainingCapacity: 2 };
test("active legacy flags are not operational authorization", () => {
  assert.equal(centerRequirements({ ...point, operationallyValidated: false }, [{ ...slot, operationallyValidated: false }], materials).length, 2);
});
test("a destination requires materials and a valid future slot with capacity when appointments are required", () => {
  assert.deepEqual(centerRequirements(point, [slot], materials), []);
  assert.equal(centerRequirements(point, [slot], []).length, 1);
  for (const patch of [{ active: false }, { remainingCapacity: 0 }, { operationallyValidated: false }, { startsAt: "2000-01-01T10:00:00Z" }]) assert.equal(centerRequirements(point, [{ ...slot, ...patch }], materials).length, 1);
  assert.deepEqual(centerRequirements({ ...point, appointmentRequired: false }, [], materials), []);
});
