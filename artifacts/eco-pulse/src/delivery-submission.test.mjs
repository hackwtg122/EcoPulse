import assert from "node:assert/strict";
import test from "node:test";
import { DeliverySubmission, deliveryRequestRejected } from "./delivery-submission.ts";

const payload = () => ({ deliveryPointId: "point", slotId: "slot", materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] });
test("uncertain delivery retries preserve payload and key without sessionStorage", () => {
  let keys = 0;
  const submission = new DeliverySubmission(() => { throw Error("storage blocked"); }, () => `delivery_key_${++keys}`);
  const input = payload();
  const first = submission.begin("user_owner", input);
  input.materials[0].estimatedGrams = 5000;
  assert.equal(submission.begin("user_owner", input), first);
  assert.equal(first.payload.materials[0].estimatedGrams, 1000);
  assert.equal(keys, 1);
  submission.complete();
  assert.notEqual(submission.begin("user_owner", input).key, first.key);
});
test("stored keys resume only matching payloads and never cross accounts", () => {
  const values = new Map();
  const storage = () => ({ getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) });
  let keys = 0;
  const create = () => new DeliverySubmission(storage, () => `delivery_key_${++keys}`);
  const first = create().begin("user_a", payload());
  const resumed = create();
  assert.equal(resumed.begin("user_a", payload()).key, first.key);
  assert.notEqual(resumed.begin("user_b", payload()).key, first.key);
  resumed.complete();
  assert.equal(values.has("ecopulse:pending-delivery-operation-v2:user_b"), false);
});
test("only definitive rejections unlock a new delivery payload", () => {
  assert.equal(deliveryRequestRejected(409, "delivery_slot_unavailable"), true);
  assert.equal(deliveryRequestRejected(400, "invalid_estimated_quantity"), true);
  for (const [status, code] of [[0, "network"], [500, "server_error"], [401, "authentication_required"], [429, "quota"], [409, "idempotency_key_reused"], [409, "idempotency_operation_incomplete"]]) {
    assert.equal(deliveryRequestRejected(status, code), false);
  }
});
