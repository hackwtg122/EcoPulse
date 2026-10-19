import assert from "node:assert/strict";
import test from "node:test";
import { isManualScanCategory, manualScanCategories, manualScanGuidance } from "./scan-catalog.ts";

test("manual scan categories match the API contract and all have guidance", () => {
  assert.deepEqual(manualScanCategories, ["paper", "plastic", "glass", "metal", "organic", "other"]);
  for (const category of manualScanCategories) {
    assert.equal(isManualScanCategory(category), true);
    assert.ok(manualScanGuidance[category].label.length > 0);
    assert.ok(manualScanGuidance[category].container.length > 0);
    assert.ok(manualScanGuidance[category].instructions.length > 0);
  }
  assert.equal(isManualScanCategory("battery"), false);
  assert.equal(isManualScanCategory({}), false);
});
