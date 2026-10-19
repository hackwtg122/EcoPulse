import assert from "node:assert/strict";
import test from "node:test";
import {
  DeliveryRequestError,
  deliveryDetailsEnabled,
  hashDetailedDeliveryInput,
  hashDeliveryIdempotencyKey,
  loadDeliveryOptions,
  parseDetailedDeliveryInput,
} from "./deliveryDetails.ts";

const pointId = "00000000-0000-5000-8000-000000000010";
const slotId = "00000000-0000-5000-8000-000000000011";

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
