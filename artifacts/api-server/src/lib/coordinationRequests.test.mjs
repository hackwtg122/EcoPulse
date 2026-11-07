import assert from "node:assert/strict";
import test from "node:test";
import {
  assignCoordinationRequest,
  cancelOwnCoordinationRequest,
  CoordinationError,
  createCoordinationRequest,
  hashCoordinationInput,
  parseCoordinationAssignment,
  parseCoordinationInput,
} from "./coordinationRequests.ts";
import { coordinationIdForIdempotency } from "./pilotPolicy.ts";

const pointId = "00000000-0000-5000-8000-000000000010";
const slotId = "00000000-0000-5000-8000-000000000011";
const requestId = "00000000-0000-5000-8000-000000000012";
const deliveryId = "00000000-0000-5000-8000-000000000013";
const owner = "user_owner";
const admin = "user_admin";
const key = "coordination_test_key";
test("targeted coordination preserves a published-center preference without assigning it",()=>{
  const materials=[{categoryCode:"paper",estimatedGrams:1000}];
  const input=parseCoordinationInput({materials,requestedPointId:pointId,preferredAt:"2026-11-08T10:00:00-05:00"});
  assert.equal(input.requestedPointId,pointId);assert.equal(input.preferredAt,"2026-11-08T15:00:00.000Z");
  assert.notEqual(hashCoordinationInput(input),hashCoordinationInput({materials,note:null}));
  assert.throws(()=>parseCoordinationInput({materials,requestedPointId:"fake-center"}),{code:"invalid_delivery_point"});
  assert.throws(()=>parseCoordinationInput({materials,preferredAt:"not-a-date"}),{code:"invalid_preferred_date"});
});

function row(overrides = {}) {
  return {
    id: requestId,
    user_id: owner,
    status: "pending",
    note: null,
    created_at: new Date(),
    updated_at: new Date(),
    delivery_id: null,
    assigned_point_id: null,
    point_code: null,
    point_name: null,
    point_municipality: null,
    delivery_status: null,
    materials: [{ categoryCode: "paper", estimatedGrams: 1000 }],
    events: [{ fromStatus: null, toStatus: "pending", reasonCode: "requested", createdAt: new Date() }],
    ...overrides,
  };
}

function client(handler) {
  const queries = [];
  return {
    queries,
    release() {},
    async query(sql, params) {
      const text = sql.trim();
      queries.push({ text, params });
      const result = await handler(text, params, queries);
      if (result !== undefined) return result;
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

const pool = (fake) => ({ connect: async () => fake });

test("coordination input accepts unique material categories and normalizes the note", () => {
  const parsed = parseCoordinationInput({
    materials: [
      { categoryCode: "plastic", estimatedGrams: 1500 },
      { categoryCode: "paper", estimatedGrams: 2500 },
    ],
    note: "  Disponible en Montería  ",
  });
  assert.deepEqual(parsed.materials.map((material) => material.categoryCode), ["paper", "plastic"]);
  assert.equal(parsed.note, "Disponible en Montería");
  assert.equal(parseCoordinationInput({ materials: [{ categoryCode: "glass", estimatedGrams: 1 }] }).note, null);
});

test("coordination input rejects duplicate categories, invalid grams and unexpected fields", () => {
  const invalid = [
    { materials: [{ categoryCode: "paper", estimatedGrams: 1000 }, { categoryCode: "paper", estimatedGrams: 1000 }] },
    { materials: [{ categoryCode: "paper", estimatedGrams: 0 }] },
    { materials: [{ categoryCode: "paper", estimatedGrams: 1.5 }] },
    { materials: [{ categoryCode: "paper", estimatedGrams: 60_000 }, { categoryCode: "plastic", estimatedGrams: 60_000 }] },
    { materials: [] },
    { materials: [{ categoryCode: "paper", estimatedGrams: 1000, extra: true }] },
    { materials: [{ categoryCode: "paper", estimatedGrams: 1000 }], extra: true },
    { materials: [{ categoryCode: "paper", estimatedGrams: 1000 }], note: "x".repeat(501) },
    { materials: [{ categoryCode: "paper", estimatedGrams: 1000 }], note: "   " },
  ];
  for (const value of invalid) {
    assert.throws(() => parseCoordinationInput(value), (error) => error instanceof CoordinationError && error.status === 400);
  }
});

test("coordination hash is deterministic and changes with materials or note", () => {
  const first = parseCoordinationInput({ materials: [{ categoryCode: "paper", estimatedGrams: 1000 }], note: null });
  const same = parseCoordinationInput({ materials: [{ categoryCode: "paper", estimatedGrams: 1000 }], note: null });
  const different = parseCoordinationInput({ materials: [{ categoryCode: "paper", estimatedGrams: 2000 }], note: null });
  assert.equal(hashCoordinationInput(first), hashCoordinationInput(same));
  assert.notEqual(hashCoordinationInput(first), hashCoordinationInput(different));
  assert.match(hashCoordinationInput(first), /^[0-9a-f]{64}$/);
});

test("creating a coordination request is idempotent and never writes a delivery", async () => {
  let storedHash = null;
  const inserted = new Set();
  const fake = client(async (text, params) => {
    if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
    if (text.startsWith("INSERT INTO coordination_requests")) {
      inserted.add(params[0]);
      storedHash = params[3];
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    if (text.startsWith("SELECT code FROM material_categories")) return { rows: [{ code: "paper" }], rowCount: 1 };
    if (text.startsWith("INSERT INTO coordination_request_items")) return { rows: [] };
    if (text.startsWith("INSERT INTO coordination_request_events")) return { rows: [] };
    if (text.includes("FROM coordination_requests r")) return { rows: [row({ id: params[0], request_hash: storedHash })] };
    return undefined;
  });
  const input = parseCoordinationInput({ materials: [{ categoryCode: "paper", estimatedGrams: 1000 }], note: "coordinar" });
  const result = await createCoordinationRequest(pool(fake), owner, key, input);
  assert.equal(result.replayed, false);
  assert.equal(result.request.status, "pending");
  assert.equal(result.request.deliveryId, null);
  assert.equal(result.request.assignedPoint, null);
  assert.equal(coordinationIdForIdempotency(owner, key), inserted.values().next().value);
  assert.equal(fake.queries.some(({ text }) => text.startsWith("INSERT INTO deliveries")), false);
});

test("replayed creation returns the stored request and conflicting payloads fail", async () => {
  const id = coordinationIdForIdempotency(owner, key);
  const input = parseCoordinationInput({ materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] });
  const storedHash = hashCoordinationInput(input);
  const fake = client(async (text, params) => {
    if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
    if (text.startsWith("INSERT INTO coordination_requests")) return { rows: [], rowCount: 0 };
    if (text.startsWith("SELECT user_id, request_hash")) return { rows: [{ user_id: owner, request_hash: storedHash }] };
    if (text.includes("FROM coordination_requests r")) return { rows: [row({ id: params[0] })] };
    return undefined;
  });
  const replay = await createCoordinationRequest(pool(fake), owner, key, input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.request.id, id);

  const conflicting = parseCoordinationInput({ materials: [{ categoryCode: "metal", estimatedGrams: 1000 }] });
  await assert.rejects(
    createCoordinationRequest(pool(fake), owner, key, conflicting),
    (error) => error instanceof CoordinationError && error.code === "idempotency_key_reused",
  );
});

test("creation fails closed when the account does not own the idempotency record", async () => {
  const fake = client(async (text) => {
    if (text === "BEGIN" || text === "ROLLBACK") return { rows: [] };
    if (text.startsWith("INSERT INTO coordination_requests")) return { rows: [], rowCount: 0 };
    if (text.startsWith("SELECT user_id, request_hash")) return { rows: [{ user_id: "user_other", request_hash: "a".repeat(64) }] };
    return undefined;
  });
  const input = parseCoordinationInput({ materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] });
  await assert.rejects(
    createCoordinationRequest(pool(fake), owner, key, input),
    (error) => error instanceof CoordinationError && error.code === "idempotency_conflict",
  );
});

test("cancelling a pending request is idempotent and blocks assigned requests", async () => {
  let status = "pending";
  const fake = client(async (text) => {
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
    if (text.startsWith("SELECT user_id, status FROM coordination_requests")) return { rows: [{ user_id: owner, status }] };
    if (text.startsWith("INSERT INTO coordination_request_events")) return { rows: [] };
    if (text.startsWith("UPDATE coordination_requests SET status = 'cancelled'")) { status = "cancelled"; return { rows: [] }; }
    return undefined;
  });
  assert.equal((await cancelOwnCoordinationRequest(pool(fake), owner, requestId)).replayed, false);
  assert.equal(status, "cancelled");
  assert.equal((await cancelOwnCoordinationRequest(pool(fake), owner, requestId)).replayed, true);

  status = "assigned";
  await assert.rejects(cancelOwnCoordinationRequest(pool(fake), owner, requestId), (error) => error.code === "coordination_already_assigned");
  await assert.rejects(cancelOwnCoordinationRequest(pool(fake), "user_other", requestId), (error) => error.code === "coordination_request_not_found");
  await assert.rejects(cancelOwnCoordinationRequest(pool(fake), owner, "not-a-uuid"), (error) => error.code === "invalid_coordination_request");
});

test("assignment requires a published center, compatible materials and a real slot, then creates one pending delivery", async () => {
  const evidence = { validation_reference: "https://example.org/authorization", validated_by: "user_operator", validated_at: new Date() };
  let requestStatus = "pending";
  const fake = client(async (text, params) => {
    if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
    if (text.startsWith("SELECT role FROM users")) return { rows: [{ role: "admin" }] };
    if (text.startsWith("SELECT r.user_id, r.status")) return { rows: [{ user_id: owner, status: requestStatus, delivery_id: requestStatus === "assigned" ? deliveryId : null, assigned_point_id: requestStatus === "assigned" ? pointId : null, slot_id: null }] };
    if (text.startsWith("SELECT appointment_required")) return { rows: [{ appointment_required: true, active: true, ...evidence }] };
    if (text.startsWith("SELECT category_code FROM delivery_point_materials")) return { rows: [{ category_code: "paper" }] };
    if (text.startsWith("SELECT category_code, estimated_grams")) return { rows: [{ category_code: "paper", estimated_grams: 1000 }], rowCount: 1 };
    if (text.startsWith("SELECT validation_reference")) return { rows: [evidence] };
    if (/^INSERT INTO (deliveries|delivery_items|delivery_status_events|coordination_request_events)/.test(text)) return { rows: [] };
    if (text.startsWith("UPDATE coordination_requests")) { requestStatus = "assigned"; return { rows: [] }; }
    if (text.includes("FROM coordination_requests r")) return { rows: [row({ status: "assigned", delivery_id: deliveryId, assigned_point_id: pointId, point_code: "center-1", point_name: "Centro", point_municipality: "Montería", delivery_status: "pending" })] };
    return undefined;
  });
  const result = await assignCoordinationRequest(pool(fake), admin, requestId, { deliveryPointId: pointId, slotId });
  assert.equal(result.replayed, false);
  assert.equal(result.request.status, "assigned");
  const insertedDelivery = fake.queries.find(({ text }) => text.startsWith("INSERT INTO deliveries"));
  assert.ok(insertedDelivery, "a real delivery row is created");
  assert.deepEqual(insertedDelivery.params.slice(1), [owner, pointId, slotId]);
  assert.equal(fake.queries.some(({ text }) => text.startsWith("INSERT INTO verifications")), false);
  assert.equal(fake.queries.some(({ text }) => text.startsWith("INSERT INTO point_movements")), false);
});

test("assignment rejects missing slot, unaccepted materials and non-administrators", async () => {
  const evidence = { validation_reference: "https://example.org/authorization", validated_by: "user_operator", validated_at: new Date() };
  const scenario = (role, point, accepted, requested) => client(async (text) => {
    if (text === "BEGIN" || text === "ROLLBACK") return { rows: [] };
    if (text.startsWith("SELECT role FROM users")) return { rows: [{ role }] };
    if (text.startsWith("SELECT r.user_id, r.status")) return { rows: [{ user_id: owner, status: "pending", delivery_id: null, assigned_point_id: null, slot_id: null }] };
    if (text.startsWith("SELECT appointment_required")) return { rows: [point] };
    if (text.startsWith("SELECT category_code FROM delivery_point_materials")) return { rows: accepted.map((code) => ({ category_code: code })) };
    if (text.startsWith("SELECT category_code, estimated_grams")) return { rows: requested, rowCount: requested.length };
    return undefined;
  });
  await assert.rejects(assignCoordinationRequest(pool(scenario("participant", { active: true, appointment_required: false, ...evidence }, ["paper"], [{ category_code: "paper" }])), admin, requestId, { deliveryPointId: pointId, slotId: null }), (error) => error.code === "admin_required");
  await assert.rejects(assignCoordinationRequest(pool(scenario("admin", { active: true, appointment_required: true, ...evidence }, ["paper"], [{ category_code: "paper" }])), admin, requestId, { deliveryPointId: pointId, slotId: null }), (error) => error.code === "delivery_slot_required");
  await assert.rejects(assignCoordinationRequest(pool(scenario("admin", { active: false, appointment_required: false, ...evidence }, ["paper"], [{ category_code: "paper" }])), admin, requestId, { deliveryPointId: pointId, slotId: null }), (error) => error.code === "delivery_point_unavailable");
  await assert.rejects(assignCoordinationRequest(pool(scenario("admin", { active: true, appointment_required: false, ...evidence }, ["plastic"], [{ category_code: "paper" }])), admin, requestId, { deliveryPointId: pointId, slotId: null }), (error) => error.code === "material_category_unavailable");
});

test("assignment parses payloads strictly and honors idempotent replay", async () => {
  assert.deepEqual(parseCoordinationAssignment({ deliveryPointId: pointId }), { deliveryPointId: pointId, slotId: null });
  assert.throws(() => parseCoordinationAssignment({ deliveryPointId: "bad" }), (error) => error.code === "invalid_delivery_point");
  assert.throws(() => parseCoordinationAssignment({ deliveryPointId: pointId, slotId: "bad" }), (error) => error.code === "invalid_delivery_slot");
  assert.throws(() => parseCoordinationAssignment({ deliveryPointId: pointId, extra: true }), (error) => error.code === "unexpected_fields");

  const evidence = { validation_reference: "https://example.org/authorization", validated_by: "user_operator", validated_at: new Date() };
  const fake = client(async (text, params) => {
    if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
    if (text.startsWith("SELECT role FROM users")) return { rows: [{ role: "admin" }] };
    if (text.startsWith("SELECT r.user_id, r.status")) return { rows: [{ user_id: owner, status: "assigned", delivery_id: deliveryId, assigned_point_id: pointId, slot_id: null }] };
    if (text.includes("FROM coordination_requests r")) return { rows: [row({ id: params[0], status: "assigned", delivery_id: deliveryId, assigned_point_id: pointId })] };
    return undefined;
  });
  const replay = await assignCoordinationRequest(pool(fake), admin, requestId, { deliveryPointId: pointId, slotId: null });
  assert.equal(replay.replayed, true);
  assert.equal(replay.deliveryId, deliveryId);
  assert.equal(fake.queries.some(({ text }) => text.startsWith("INSERT INTO deliveries")), false);
  assert.ok(evidence.validated_at);
});
