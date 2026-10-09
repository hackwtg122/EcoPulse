import assert from "node:assert/strict";
import test from "node:test";
import { pointsForVerifiedGrams, validIdempotencyKey, validReceiptCode } from "./pilotPolicy.ts";

test("only verified positive grams earn configured whole points", () => {
  assert.equal(pointsForVerifiedGrams(500, 20), 10);
  assert.equal(pointsForVerifiedGrams(1, 20), 0);
  assert.throws(() => pointsForVerifiedGrams(0, 20), RangeError);
  assert.throws(() => pointsForVerifiedGrams(500, 0), RangeError);
  assert.throws(() => pointsForVerifiedGrams(100_001, 20), RangeError);
});

test("idempotency keys are bounded and ASCII safe", () => {
  assert.equal(validIdempotencyKey("pilot_123"), true);
  assert.equal(validIdempotencyKey("short"), false);
  assert.equal(validIdempotencyKey("x".repeat(129)), false);
  assert.equal(validIdempotencyKey("with space"), false);
});

test("physical receipt codes are bounded", () => {
  assert.equal(validReceiptCode("receipt_123"), true);
  assert.equal(validReceiptCode("short"), false);
  assert.equal(validReceiptCode("x".repeat(65)), false);
});
