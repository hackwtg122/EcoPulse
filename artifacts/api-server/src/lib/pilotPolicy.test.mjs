import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryIdForIdempotency,
  encodeDeliveryCursor,
  parseDeliveryCursor,
  parseDeliveryPageLimit,
  pointsForVerifiedGrams,
  parsePointsPolicy,
  quotaRetryAfterSeconds,
  validRejectionReason,
  verificationActionsEnabled,
  scanCategories,
  scanIdForIdempotency,
  validIdempotencyKey,
  validReceiptCode,
  validScanCategory,
} from "./pilotPolicy.ts";

test("a denied quota window reports when the client may retry", () => {
  const minuteBoundary = Date.UTC(2026, 9, 19, 12, 34, 20); // 40s into the minute
  assert.equal(quotaRetryAfterSeconds("user_minute", minuteBoundary), 40);
  assert.equal(quotaRetryAfterSeconds("user_daily", minuteBoundary), 24 * 60 * 60 - (20 + 34 * 60 + 12 * 60 * 60));
  assert.equal(quotaRetryAfterSeconds("global_daily", minuteBoundary), quotaRetryAfterSeconds("user_daily", minuteBoundary));
  assert.equal(quotaRetryAfterSeconds("concurrent", minuteBoundary), 5);
  for (const reason of ["user_minute", "user_daily", "global_daily", "concurrent"]) {
    assert.ok(quotaRetryAfterSeconds(reason, Date.now()) >= 1);
  }
});

test("scan categories are explicit and reject unsupported values", () => {
  assert.deepEqual(scanCategories, ["paper", "plastic", "glass", "metal", "organic", "other"]);
  assert.equal(validScanCategory("paper"), true);
  assert.equal(validScanCategory("battery"), false);
  assert.equal(validScanCategory(1), false);
});

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

test("scan idempotency is durable, account scoped, and produces UUIDs", () => {
  const first = scanIdForIdempotency("user-a", "scan_operation_123");
  assert.equal(first, scanIdForIdempotency("user-a", "scan_operation_123"));
  assert.notEqual(first, scanIdForIdempotency("user-b", "scan_operation_123"));
  assert.notEqual(first, scanIdForIdempotency("user-a", "scan_operation_456"));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("delivery idempotency is stable, account scoped, and namespace separated", () => {
  const first = deliveryIdForIdempotency("user-a", "delivery_operation_123");
  assert.equal(first, deliveryIdForIdempotency("user-a", "delivery_operation_123"));
  assert.notEqual(first, deliveryIdForIdempotency("user-b", "delivery_operation_123"));
  assert.notEqual(first, deliveryIdForIdempotency("user-a", "delivery_operation_456"));
  assert.notEqual(first, scanIdForIdempotency("user-a", "delivery_operation_123"));
});

test("concurrent delivery retries converge on one durable identifier", async () => {
  const ids = await Promise.all(Array.from({ length: 100 }, async () =>
    deliveryIdForIdempotency("user-a", "delivery_concurrent_123"),
  ));
  assert.equal(new Set(ids).size, 1);
});

test("delivery pagination cursors are opaque, bounded, and validated", () => {
  const id = "00000000-0000-5000-8000-000000000001";
  const date = new Date("2026-10-14T12:00:00.000Z");
  const encoded = encodeDeliveryCursor(date, id);
  const parsed = parseDeliveryCursor(encoded);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value?.createdAt.toISOString(), date.toISOString());
    assert.equal(parsed.value?.id, id);
  }
  assert.deepEqual(parseDeliveryCursor(undefined), { ok: true, value: null });
  assert.deepEqual(parseDeliveryCursor("not_base64"), { ok: false });
  assert.deepEqual(parseDeliveryCursor("x".repeat(257)), { ok: false });
});

test("delivery page limits reject arrays, zero, and oversized values", () => {
  assert.equal(parseDeliveryPageLimit(undefined), 20);
  assert.equal(parseDeliveryPageLimit("1"), 1);
  assert.equal(parseDeliveryPageLimit("50"), 50);
  assert.equal(parseDeliveryPageLimit("0"), null);
  assert.equal(parseDeliveryPageLimit("51"), null);
  assert.equal(parseDeliveryPageLimit(["20"]), null);
});

test("physical receipt codes are bounded", () => {
  assert.equal(validReceiptCode("receipt_123"), true);
  assert.equal(validReceiptCode("short"), false);
  assert.equal(validReceiptCode("x".repeat(65)), false);
});


test("physical workflow stays disabled without exact flags and a bounded points policy", () => {
  assert.equal(verificationActionsEnabled(undefined), false);
  assert.equal(verificationActionsEnabled("TRUE"), false);
  assert.equal(parsePointsPolicy(undefined, undefined), null);
  assert.equal(parsePointsPolicy("10", "30")?.maxPointsPerDelivery, 30);
  for (const [rate, cap] of [["0", "30"], ["1001", "30"], ["10", "0"], ["10", "100001"], ["10.5", "30"]]) {
    assert.equal(parsePointsPolicy(rate, cap), null);
  }
  assert.equal(validRejectionReason("contaminated"), true);
  assert.equal(validRejectionReason("approve"), false);
});
