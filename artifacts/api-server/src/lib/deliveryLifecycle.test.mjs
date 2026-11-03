import assert from "node:assert/strict";
import test from "node:test";
import { updateOwnDeliveryStatus, verifyPhysicalDelivery } from "./deliveryLifecycle.ts";

const deliveryId = "00000000-0000-4000-8000-000000000001";
const pointId = "00000000-0000-4000-8000-000000000002";
const slotId = "00000000-0000-4000-8000-000000000003";

function poolFor({ version = 2, reference = "https://example.org/center", status = "received", hasSlot = false } = {}) {
  const queries = [];
  const client = { release() {}, async query(sql, params) {
    const text = sql.trim();
    queries.push({ text, params });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
    if (text.startsWith("SELECT id, user_id, status FROM deliveries")) return { rows: [{ id: deliveryId, user_id: "user_owner", status }] };
    if (text.startsWith("SELECT request_version, delivery_point_id")) return { rows: [{ request_version: version, delivery_point_id: version === 2 ? pointId : null, slot_id: hasSlot ? slotId : null }] };
    if (text.startsWith("SELECT active, appointment_required")) return { rows: [{ active: true, appointment_required: false, validation_reference: reference, validated_by: "user_admin", validated_at: new Date() }] };
    if (text.startsWith("SELECT validation_reference, validated_by")) return { rows: [{ validation_reference: "https://example.org/slot", validated_by: "user_admin", validated_at: new Date() }] };
    if (text.startsWith("SELECT s.id FROM deliveries")) return { rowCount: hasSlot ? 1 : 0, rows: hasSlot ? [{ id: slotId }] : [] };
    if (text.startsWith("SELECT id, verifier_id, decision")) return { rows: [{ id: pointId, verifier_id: "user_verifier", decision: "approved", verified_grams: 6000, receipt_code: "receipt_123" }] };
    if (text.startsWith("SELECT coalesce(sum(delta)")) return { rows: [{ points: "100" }] };
    if (text.startsWith("INSERT INTO verifications") || text.startsWith("INSERT INTO delivery_status_events") || text.startsWith("UPDATE deliveries") || text.startsWith("INSERT INTO point_movements")) return { rows: [], rowCount: 1 };
    throw Error(`unexpected query: ${text}`);
  } };
  return { queries, connect: async () => client };
}

test("V1 and unverified destinations cannot be approved or create points", async () => {
  for (const config of [{ version: 1 }, { reference: "academic:ecopulse/centro-01" }]) {
    const pool = poolFor(config);
    await assert.rejects(verifyPhysicalDelivery(pool, "user_verifier", "verifier", deliveryId, "approved", 6000, "receipt_123", 20, null, 100), error => error.code === "delivery_destination_unverified");
    assert.equal(pool.queries.at(-1).text, "ROLLBACK");
    assert.ok(!pool.queries.some(query => query.text.startsWith("INSERT INTO point_movements")));
  }
});

test("received delivery at verified destination credits at most 100 points atomically", async () => {
  const pool = poolFor();
  const result = await verifyPhysicalDelivery(pool, "user_verifier", "verifier", deliveryId, "approved", 6000, "receipt_123", 20, null, 100);
  assert.equal(result.points, 100);
  const movement = pool.queries.find(query => query.text.startsWith("INSERT INTO point_movements"));
  assert.equal(movement.params[1], "user_owner");
  assert.equal(movement.params[2], 100);
  assert.equal(pool.queries.at(-1).text, "COMMIT");
});

test("rejection remains possible without a verified destination and awards no points", async () => {
  const pool = poolFor({ version: 1 });
  const result = await verifyPhysicalDelivery(pool, "user_verifier", "verifier", deliveryId, "rejected", null, null, null, "material_not_received");
  assert.equal(result.points, 0);
  assert.ok(!pool.queries.some(query => query.text.startsWith("INSERT INTO point_movements")));
  assert.ok(!pool.queries.some(query => query.text.startsWith("SELECT request_version")));
});

test("replaying an approval returns existing points without another credit", async () => {
  const pool = poolFor({ status: "approved" });
  const result = await verifyPhysicalDelivery(pool, "user_verifier", "verifier", deliveryId, "approved", 6000, "receipt_123", 20, null, 100);
  assert.equal(result.replayed, true);
  assert.equal(result.points, 100);
  assert.ok(!pool.queries.some(query => query.text.startsWith("INSERT INTO point_movements")));
});

test("owners can schedule a validated slot and cancel pending requests without points", async () => {
  const scheduled = poolFor({ status: "pending", hasSlot: true });
  assert.equal((await updateOwnDeliveryStatus(scheduled, "user_owner", deliveryId, "schedule")).status, "scheduled");
  assert.ok(!scheduled.queries.some(query => query.text.startsWith("INSERT INTO point_movements")));
  const cancelled = poolFor({ status: "pending", version: 1 });
  assert.equal((await updateOwnDeliveryStatus(cancelled, "user_owner", deliveryId, "cancel")).status, "cancelled");
  assert.equal(cancelled.queries.at(-1).text, "COMMIT");
});

test("owner transitions are idempotent and reject other users or received deliveries", async () => {
  const replay = poolFor({ status: "cancelled" });
  assert.equal((await updateOwnDeliveryStatus(replay, "user_owner", deliveryId, "cancel")).replayed, true);
  assert.ok(!replay.queries.some(query => query.text.startsWith("UPDATE deliveries")));
  await assert.rejects(updateOwnDeliveryStatus(poolFor({ status: "pending" }), "user_other", deliveryId, "cancel"), error => error.code === "delivery_not_found");
  await assert.rejects(updateOwnDeliveryStatus(poolFor({ status: "received" }), "user_owner", deliveryId, "cancel"), error => error.code === "delivery_not_cancellable");
  await assert.rejects(updateOwnDeliveryStatus(poolFor({ status: "pending", version: 1 }), "user_owner", deliveryId, "schedule"), error => error.code === "delivery_destination_unverified");
});
