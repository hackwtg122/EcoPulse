import assert from "node:assert/strict";
import test from "node:test";
import { createDraftPoint, createDraftSlot, updateDraftPoint, updateDraftSlot, updateDraftPointCoordinates, replaceDraftPointMaterials, validateCatalogPoint, validateCatalogSlot, updateActiveSlotCapacity, deactivateCatalogRecord } from "./deliveryCatalog.ts";
import { createRewardDraft, editRewardDraft } from "./rewardService.ts";

const id = "00000000-0000-4000-8000-000000000001", actor = "user_Admin";
const point = { code: "unit-only", name: "Unit fixture", address: "Unit fixture", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true };
const slot = { pointId: id, startsAt: new Date("2099-01-01T10:00:00Z"), endsAt: new Date("2099-01-01T11:00:00Z"), capacity: 2 };
const draft = { title: "Unit fixture", description: "In-memory only", cost: 2 };
const actions = {
  createPoint: pool => createDraftPoint(pool, actor, point),
  createSlot: pool => createDraftSlot(pool, actor, slot),
  editPoint: pool => updateDraftPoint(pool, actor, id, point),
  editSlot: pool => updateDraftSlot(pool, actor, id, slot),
  coordinates: pool => updateDraftPointCoordinates(pool, actor, id, { latitude: null, longitude: null }),
  materials: pool => replaceDraftPointMaterials(pool, actor, id, ["paper"]),
  publishPoint: pool => validateCatalogPoint(pool, id, actor, "https://example.org/unit"),
  publishSlot: pool => validateCatalogSlot(pool, id, actor, "https://example.org/unit"),
  capacity: pool => updateActiveSlotCapacity(pool, id, actor, 3, "https://example.org/unit"),
  deactivate: pool => deactivateCatalogRecord(pool, actor, "points", id),
  createReward: pool => createRewardDraft(pool, actor, "unit_intent_123", draft),
  editReward: pool => editRewardDraft(pool, actor, id, draft, { ...draft, cost: 3 }),
};

function poolFor(role, failWrite = false) {
  const queries = [];
  let released = false;
  return { queries, released: () => released, async connect() { return {
    release() { released = true; },
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.startsWith("SELECT role FROM users")) { assert.deepEqual(params, [actor]); return { rows: role ? [{ role }] : [] }; }
      if (sql.startsWith("SELECT EXISTS")) return { rows: [{ ready: true }] };
      if (sql.startsWith("SELECT p.active")) return { rows: [{ active: true, validation_reference: "https://example.org/confirmed", validated_at: new Date(), validated_by: actor }] };
      if (/^(INSERT|UPDATE|DELETE)/.test(sql)) {
        if (failWrite) throw Object.assign(Error("injected_failure"), { code: "XX000" });
        if (sql.startsWith("INSERT INTO rewards")) return { rowCount: 1, rows: [{ id: params[0], title: params[1], description: params[2], cost: params[3] }] };
        return { rowCount: 1, rows: [{ id, active: true }] };
      }
      if (sql.startsWith("SELECT id FROM delivery_slots")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT code FROM material_categories")) return { rowCount: 1, rows: [{ code: "paper" }] };
      if (sql.startsWith("SELECT id")) return { rowCount: 1, rows: [{ id, appointment_required: true }] };
      throw Error("Unexpected query " + sql);
    },
  }; } };
}

for (const [name, action] of Object.entries(actions)) {
  test(name + " denies stale middleware authorization after role revocation", async () => {
    for (const role of [null, "participant", "verifier"]) {
      const pool = poolFor(role);
      await assert.rejects(action(pool), { status: 403, code: "admin_required" });
      assert.equal(pool.queries.at(-1).sql, "ROLLBACK");
      assert.match(pool.queries[1].sql, /FOR SHARE/);
      assert.ok(!pool.queries.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql)));
      assert.ok(pool.released());
    }
  });
  test(name + " locks the current admin role until commit and rolls back failures", async () => {
    for (const failWrite of [false, true]) {
      const pool = poolFor("admin", failWrite);
      if (failWrite) await assert.rejects(action(pool), { code: "XX000" });
      else await action(pool);
      assert.match(pool.queries[1].sql, /FOR SHARE/);
      assert.equal(pool.queries.at(-1).sql, failWrite ? "ROLLBACK" : "COMMIT");
      assert.ok(pool.released());
    }
  });
}
