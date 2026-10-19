import assert from "node:assert/strict";
import test from "node:test";
import { listEvaluationTestPoints } from "./evaluationPoints.ts";

test("evaluation test points are static, isolated and clearly labelled", () => {
  const points = listEvaluationTestPoints();
  assert.equal(points.length, 8);
  for (const point of points) {
    assert.equal(point.isTest, true, "every evaluation point must carry isTest");
    assert.ok(Number.isFinite(point.lat) && Math.abs(point.lat) <= 90, "latitude must be valid");
    assert.ok(Number.isFinite(point.lng) && Math.abs(point.lng) <= 180, "longitude must be valid");
    // All points stay inside the Montería operating zone (approximate bounds).
    assert.ok(point.lat > 8.5 && point.lat < 9.0, `${point.id} must stay near Montería`);
    assert.ok(point.lng > -76.1 && point.lng < -75.6, `${point.id} must stay near Montería`);
    assert.ok(point.materials.length >= 1, "materials required");
    assert.ok(point.hours.length > 0 && point.capacity >= 1, "hours and capacity required");
    assert.ok(point.responsible.includes("prueba"), "responsible must be flagged as test operator");
  }
  const ids = new Set(points.map((p) => p.id));
  assert.equal(ids.size, 8, "ids must be unique");
});

test("evaluation points are frozen against runtime mutation", () => {
  const points = listEvaluationTestPoints();
  assert.throws(() => { points[0].name = "changed"; }, TypeError);
  assert.equal(listEvaluationTestPoints()[0].name.includes("PRUEBA"), true, "names must keep the PRUEBA label");
});
