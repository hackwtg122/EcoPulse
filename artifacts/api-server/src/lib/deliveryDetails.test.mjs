import assert from "node:assert/strict";
import test from "node:test";
import {
  DeliveryRequestError,
  createDetailedDelivery,
  deliveryDetailsEnabled,
  hashDetailedDeliveryInput,
  hashDeliveryIdempotencyKey,
  hasOperationalEvidence,
  loadDeliveryOptions,
  loadPublishedDeliveryPoints,
  parseDetailedDeliveryInput,
  validateAppointmentSelection,
} from "./deliveryDetails.ts";

const pointId = "00000000-0000-5000-8000-000000000010";
const slotId = "00000000-0000-5000-8000-000000000011";
test("operational selection exposes only usable destinations and preserves the administrator's validated text", async () => {
  const evidence = { validation_reference: "https://example.org/authorization", validated_by: "user_Admin", validated_at: new Date() };
  const base = { code: "eval-01", name: "Centro Universitario autorizado", address: "Dirección exacta autorizada", municipality: "Montería", time_zone: "America/Bogota", appointment_required: false, ...evidence };
  const database = { async query(sql) {
    if (sql.includes("to_regclass") || sql.includes("information_schema.columns")) return { rows: [{ ready: true, present: true }] };
    if (sql.includes("FROM material_categories")) return { rows: [{ code: "paper" }] };
    if (sql.includes("FROM delivery_point_materials")) return { rows: [{ delivery_point_id: "walkin", category_code: "paper" }, { delivery_point_id: "no-slot", category_code: "paper" }] };
    if (sql.includes("FROM delivery_points")) return { rows: [{ ...base, id: "walkin" }, { ...base, id: "no-materials" }, { ...base, id: "no-slot", appointment_required: true }] };
    if (sql.includes("FROM delivery_slots")) return { rows: [] };
    throw Error("Unexpected SQL " + sql);
  } };
  const options = await loadDeliveryOptions(database, true, true);
  assert.equal(options.enabled, true);
  assert.deepEqual(options.points.map(point => point.id), ["walkin"]);
  assert.equal(options.points[0].name, base.name);
  assert.equal(options.points[0].address, base.address);
  assert.equal(options.points[0].latitude, null);
});

test("operational evidence excludes reference-only and unvalidated records", () => {
  const row = { validation_reference: "https://example.org/center", validated_by: "user_Admin", validated_at: new Date() };
  assert.equal(hasOperationalEvidence(row), true);
  assert.equal(hasOperationalEvidence({ ...row, validation_reference: "academic:ecopulse/centro-01" }), false);
  assert.equal(hasOperationalEvidence({ ...row, validated_at: null }), false);
  assert.equal(hasOperationalEvidence({ ...row, validated_by: null }), false);
});

test("operational delivery options exclude unverified locations while published browsing remains available", async () => {
  const previousMode = process.env.EVALUATION_MODE_ENABLED;
  delete process.env.EVALUATION_MODE_ENABLED;
  const database = { async query(text) {
    if (text.includes("to_regclass") || text.includes("information_schema.columns")) return { rows: [{ ready: true }] };
    if (text.includes("FROM material_categories")) return { rows: [{ code: "paper" }] };
    if (text.includes("FROM delivery_point_materials")) return { rows: [] };
    if (text.includes("FROM delivery_points")) return { rows: [{ id: pointId, code: "eval-01", name: "Centro académico", address: "Sector", municipality: "Montería", time_zone: "America/Bogota", appointment_required: false, validation_reference: "academic:ecopulse/centro-01", validated_by: "user_Admin", validated_at: new Date() }] };
    if (text.includes("FROM delivery_slots")) return { rows: [] };
    throw new Error("unexpected_mock_query");
  } };
  try {
    assert.equal((await loadPublishedDeliveryPoints(database)).length, 1);
    const options = await loadDeliveryOptions(database, true, true);
    assert.equal(options.enabled, false);
    assert.deepEqual(options.points, []);
    process.env.EVALUATION_MODE_ENABLED = "true";
    assert.deepEqual((await loadDeliveryOptions(database, true, true)).points, [], "evaluation mode must not bypass operational evidence");
  } finally {
    if (previousMode === undefined) delete process.env.EVALUATION_MODE_ENABLED; else process.env.EVALUATION_MODE_ENABLED = previousMode;
  }
});

test("published accepted materials are returned for a center and missing read permission fails closed", async () => {
  const previousMode = process.env.EVALUATION_MODE_ENABLED;
  delete process.env.EVALUATION_MODE_ENABLED;
  const database = canRead => ({ async query(text) {
    if (text.includes("has_table_privilege")) return { rows: [{ present: true, ready: canRead }] };
    if (text.includes("to_regclass")) return { rows: [{ ready: true }] };
    if (text.includes("FROM material_categories")) return { rows: [{ code: "paper" }, { code: "plastic" }] };
    if (text.includes("FROM delivery_point_materials")) return { rows: [{ delivery_point_id: pointId, category_code: "paper" }] };
    if (text.includes("FROM delivery_points")) return { rows: [{ id: pointId, code: "center-1", name: "Centro", address: "Dirección", municipality: "Montería", time_zone: "America/Bogota", appointment_required: false }] };
    if (text.includes("FROM delivery_slots")) return { rows: [] };
    throw Error("unexpected_mock_query");
  } });
  try {
    const options = await loadDeliveryOptions(database(true), true);
    assert.deepEqual(options.points[0].materials, ["paper"]);
    const blocked = await loadDeliveryOptions(database(false), true);
    assert.equal(blocked.enabled, false);
    assert.deepEqual(blocked.points, []);
  } finally {
    if (previousMode === undefined) delete process.env.EVALUATION_MODE_ENABLED; else process.env.EVALUATION_MODE_ENABLED = previousMode;
  }
});

test("published browsing stays available while detailed creation remains disabled and never writes", async () => {
  const previousMode = process.env.EVALUATION_MODE_ENABLED;
  delete process.env.EVALUATION_MODE_ENABLED;
  const database = { async query(text) {
    assert.match(text.trim(), /^SELECT\b/i);
    if (text.includes("to_regclass")) return { rows: [{ ready: true }] };
    if (text.includes("FROM material_categories")) return { rows: [{ code: "paper" }] };
    if (text.includes("FROM delivery_point_materials")) return { rows: [] };
    if (text.includes("FROM delivery_points")) return { rows: [{ id: pointId, code: "existing", name: "Published", address: "Address", municipality: "Montería", time_zone: "America/Bogota", appointment_required: true }] };
    if (text.includes("FROM delivery_slots")) return { rows: [] };
    throw new Error("unexpected_mock_query");
  } };
  try {
    assert.deepEqual((await loadDeliveryOptions(database, false)).points, []);
    const points = await loadPublishedDeliveryPoints(database);
    assert.equal(points.length, 1);
    assert.deepEqual(points[0].slots, []);
    assert.equal((await loadDeliveryOptions(database, true)).enabled, false);
  } finally {
    if (previousMode === undefined) delete process.env.EVALUATION_MODE_ENABLED; else process.env.EVALUATION_MODE_ENABLED = previousMode;
  }
});

test("appointment selection follows the actual destination trigger without promising walk-in capacity", () => {
  assert.doesNotThrow(() => validateAppointmentSelection(false, null));
  assert.doesNotThrow(() => validateAppointmentSelection(true, slotId));
  assert.throws(() => validateAppointmentSelection(true, null), error => error.code === "delivery_slot_required");
  assert.throws(() => validateAppointmentSelection(false, slotId), error => error.code === "delivery_slot_not_applicable");
});

test("a validated walk-in center enables detailed requests without a slot", async () => {
  const mode = process.env.EVALUATION_MODE_ENABLED;
  delete process.env.EVALUATION_MODE_ENABLED;
  try {
    const options = await loadDeliveryOptions({ async query(text) {
      if (text.includes("to_regclass")) return { rows: [{ ready: true }] };
      if (text.includes("SELECT code FROM material_categories")) return { rows: [{ code: "paper" }] };
      if (text.includes("FROM delivery_point_materials")) return { rows: [{ delivery_point_id: pointId, category_code: "paper" }] };
      if (text.includes("FROM delivery_points")) return { rows: [{ id: pointId, code: "test-walk-in", name: "Test", address: "Test", municipality: "Test", time_zone: "America/Bogota", appointment_required: false }] };
      if (text.includes("FROM delivery_slots")) return { rows: [] };
      throw new Error("unexpected_mock_query");
    } }, true);
    assert.equal(options.enabled, true);
    assert.equal(options.points[0].appointmentRequired, false);
    assert.deepEqual(options.points[0].slots, []);
  } finally {
    if (mode === undefined) delete process.env.EVALUATION_MODE_ENABLED; else process.env.EVALUATION_MODE_ENABLED = mode;
  }
});

test("a center without configured materials cannot enable deliveries", async () => {
  const database = { async query(text) {
    if (text.includes("to_regclass") || text.includes("information_schema.columns")) return { rows: [{ ready: true }] };
    if (text.includes("FROM material_categories")) return { rows: [{ code: "paper" }] };
    if (text.includes("FROM delivery_point_materials")) return { rows: [] };
    if (text.includes("FROM delivery_points")) return { rows: [{ id: pointId, code: "center", name: "Centro", address: "Dirección", municipality: "Montería", time_zone: "America/Bogota", appointment_required: false, validation_reference: "https://example.org/center", validated_by: "admin", validated_at: new Date() }] };
    if (text.includes("FROM delivery_slots")) return { rows: [] };
    throw Error("unexpected_mock_query");
  } };
  const options = await loadDeliveryOptions(database, true, true);
  assert.equal(options.enabled, false);
  assert.deepEqual(options.points, [], "a center without accepted materials must not appear as a selectable destination");
});

test("creation rejects unconfigured center materials and rolls back", async () => {
  const queries = [];
  const client = { release() {}, async query(sql) {
    const text = sql.trim(); queries.push(text);
    if (text === "BEGIN" || text === "ROLLBACK" || text.startsWith("SELECT pg_advisory") || text.startsWith("INSERT INTO delivery_idempotency")) return { rows: [] };
    if (text.startsWith("SELECT request_hash")) return { rows: [] };
    if (text.startsWith("SELECT code FROM material_categories")) return { rows: [{ code: "paper" }], rowCount: 1 };
    if (text.startsWith("SELECT appointment_required")) return { rows: [{ appointment_required: false, validation_reference: "https://example.org/center", validated_by: "admin", validated_at: new Date() }] };
    if (text.includes("to_regclass('public.delivery_point_materials')")) return { rows: [{ present: true, ready: true }] };
    if (text.startsWith("SELECT category_code FROM delivery_point_materials")) return { rows: [] };
    throw Error(`unexpected query: ${text}`);
  } };
  const input = parseDetailedDeliveryInput({ deliveryPointId: pointId, slotId: null, materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] });
  await assert.rejects(createDetailedDelivery({ connect: async () => client }, "user_owner", "delivery_test_123", input), error => error.code === "material_category_unavailable");
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.some(text => text.startsWith("INSERT INTO deliveries")));
});

test("delivery creation requires real center and slot evidence even in evaluation mode", async () => {
  const priorMode = process.env.EVALUATION_MODE_ENABLED;
  const evidence = { validation_reference: "https://example.org/operational-evidence", validated_by: "user_operator", validated_at: new Date() };
  const referenceOnly = { ...evidence, validation_reference: "academic:ecopulse/center" };
  try {
    for (const mode of ["false", "true"]) {
      process.env.EVALUATION_MODE_ENABLED = mode;
      for (const scenario of [
        { point: referenceOnly, slot: evidence, expected: "delivery_point_unavailable" },
        { point: { ...evidence, validated_at: null }, slot: evidence, expected: "delivery_point_unavailable" },
        { point: evidence, slot: referenceOnly, expected: "delivery_slot_unavailable" },
        { point: evidence, slot: { ...evidence, validated_by: null }, expected: "delivery_slot_unavailable" },
        { point: evidence, slot: evidence, expected: "before_commit_reached" },
        { point: evidence, slot: null, expected: "before_commit_reached" },
      ]) {
        const queries = [];
        const client = { release() {}, async query(sql) {
          const text = sql.trim(); queries.push(text);
          if (["BEGIN", "ROLLBACK"].includes(text) || /^(INSERT|UPDATE)\b/.test(text) || text.startsWith("SELECT pg_advisory")) return { rows: [] };
          if (text.startsWith("SELECT request_hash")) return { rows: [] };
          if (text.startsWith("SELECT code FROM material_categories")) return { rows: [{ code: "paper" }], rowCount: 1 };
          if (text.startsWith("SELECT appointment_required")) return { rows: [{ appointment_required: !!scenario.slot, ...scenario.point }] };
          if (text.includes("to_regclass('public.delivery_point_materials')")) return { rows: [{ present: true, ready: true }] };
          if (text.startsWith("SELECT category_code FROM delivery_point_materials")) return { rows: [{ category_code: "paper" }] };
          if (text.startsWith("SELECT id, capacity")) return { rows: [{ id: slotId, capacity: 1, ...scenario.slot }] };
          if (text.startsWith("SELECT count(*)")) return { rows: [{ count: 0 }] };
          throw Error(`unexpected query: ${text}`);
        } };
        const input = parseDetailedDeliveryInput({ deliveryPointId: pointId, slotId: scenario.slot ? slotId : null, materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] });
        await assert.rejects(createDetailedDelivery({ connect: async () => client }, "user_owner", "delivery_regression_key", input, {
          beforeCommit: async () => { throw Object.assign(Error("stop before commit"), { code: "before_commit_reached" }); },
        }), error => error.code === scenario.expected, `${mode}: ${scenario.expected}`);
        assert.equal(queries.at(-1), "ROLLBACK");
        assert.equal(queries.some(sql => sql.startsWith("INSERT INTO deliveries")), scenario.expected === "before_commit_reached");
      }
    }
  } finally {
    if (priorMode === undefined) delete process.env.EVALUATION_MODE_ENABLED;
    else process.env.EVALUATION_MODE_ENABLED = priorMode;
  }
});

test("delivery details require an exact and bounded payload", () => {
  const parsed = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId,
    materials: [
      { categoryCode: "plastic", estimatedGrams: 1200 },
      { categoryCode: "paper", estimatedGrams: 2500 },
    ],
  });
  assert.deepEqual(parsed.materials.map((item) => item.categoryCode), ["paper", "plastic"]);
  assert.throws(
    () => parseDetailedDeliveryInput({ deliveryPointId: pointId, slotId, materials: [{ categoryCode: "paper", estimatedGrams: 0 }] }),
    (error) => error instanceof DeliveryRequestError && error.code === "invalid_estimated_quantity",
  );
  assert.throws(
    () => parseDetailedDeliveryInput({ deliveryPointId: pointId, slotId, materials: [{ categoryCode: "paper", estimatedGrams: 1 }, { categoryCode: "paper", estimatedGrams: 2 }] }),
    (error) => error instanceof DeliveryRequestError && error.code === "duplicate_material_category",
  );
  assert.throws(
    () => parseDetailedDeliveryInput({ deliveryPointId: pointId, slotId, userId: "other", materials: [{ categoryCode: "paper", estimatedGrams: 1 }] }),
    (error) => error instanceof DeliveryRequestError && error.code === "unexpected_fields",
  );
});

test("canonical request hashes ignore material ordering but detect changed content", () => {
  const first = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId,
    materials: [{ categoryCode: "paper", estimatedGrams: 2500 }, { categoryCode: "plastic", estimatedGrams: 1200 }],
  });
  const reordered = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId,
    materials: [{ categoryCode: "plastic", estimatedGrams: 1200 }, { categoryCode: "paper", estimatedGrams: 2500 }],
  });
  const changed = parseDetailedDeliveryInput({
    deliveryPointId: pointId,
    slotId,
    materials: [{ categoryCode: "paper", estimatedGrams: 2600 }, { categoryCode: "plastic", estimatedGrams: 1200 }],
  });
  assert.equal(hashDetailedDeliveryInput(first), hashDetailedDeliveryInput(reordered));
  assert.notEqual(hashDetailedDeliveryInput(first), hashDetailedDeliveryInput(changed));
  assert.match(hashDeliveryIdempotencyKey("delivery_operation_123"), /^[0-9a-f]{64}$/);
});

test("delivery details require an exact staged activation value", () => {
  assert.equal(deliveryDetailsEnabled("true"), true);
  assert.equal(deliveryDetailsEnabled("TRUE"), false);
  assert.equal(deliveryDetailsEnabled(undefined), false);
});

test("academic center materials and slots come from the same database queryable", async () => {
  const oldMode = process.env.EVALUATION_MODE_ENABLED;
  process.env.EVALUATION_MODE_ENABLED = "true";
  try {
    const database = { async query(text) {
      if (text.includes("to_regclass('public.material_categories')")) return { rows: [{ ready: true }] };
      if (text.includes("to_regclass('public.delivery_point_materials')")) return { rows: [{ ready: true }] };
      if (text.includes("SELECT code FROM material_categories")) return { rows: [{ code: "paper" }, { code: "glass" }] };
      if (text.includes("FROM delivery_points")) return { rows: [{ id: pointId, code: "eval-01", name: "Centro", address: "Zona", municipality: "Montería", time_zone: "America/Bogota", appointment_required: true }] };
      if (text.includes("FROM delivery_slots")) return { rows: [{ id: slotId, delivery_point_id: pointId, starts_at: new Date(), ends_at: new Date(), remaining_capacity: 7 }] };
      if (text.includes("FROM delivery_point_materials")) return { rows: [{ delivery_point_id: pointId, category_code: "paper" }] };
      throw new Error("Unexpected query");
    } };
    const options = await loadDeliveryOptions(database, true);
    assert.equal(options.enabled, true);
    assert.deepEqual(options.points[0].materials, ["paper"]);
    assert.equal(options.points[0].slots[0].remainingCapacity, 7);
  } finally {
    if (oldMode === undefined) delete process.env.EVALUATION_MODE_ENABLED;
    else process.env.EVALUATION_MODE_ENABLED = oldMode;
  }
});
