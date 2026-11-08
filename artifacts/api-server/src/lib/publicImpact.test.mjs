import assert from "node:assert/strict";
import test from "node:test";
import { loadPublicImpact } from "./publicImpact.ts";
import { digitalAssetCatalog } from "./digitalAssetRegistry.ts";

const digital = digitalAssetCatalog().find(row => row.key === "guide-v1");
assert.ok(digital);

function fakePool() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes("AS centers")) return { rows: [{ centers: 8, challenges: 10, verified_deliveries: 0 }] };
      if (sql.includes("FROM delivery_points")) return { rows: [
        { id: "center-1", name: "Zona EcoPulse Los Ángeles", municipality: "Montería", latitude: 8.77, longitude: -75.87 },
        { id: "center-without-coordinates", name: "Publicada sin coordenadas", municipality: "Montería", latitude: null, longitude: null },
      ] };
      if (sql.includes("FROM rewards")) return { rows: [
        { id: "digital-guide", title: "Kit digital de reciclaje", cost: 20, inventory_remaining: 20, fulfillment_reference: digital.evidenceReference },
        { id: "unknown", title: "Premio no documentado", cost: 100, inventory_remaining: 5, fulfillment_reference: "https://invalid.test/asset" },
      ] };
      throw Error("Unexpected SQL query");
    },
  };
}

test("public snapshot uses real aggregated counts and only verified digital assets", async () => {
  const pool = fakePool();
  const snapshot = await loadPublicImpact(pool);
  assert.deepEqual({ centers: snapshot.centers, challenges: snapshot.challenges, rewards: snapshot.rewards, verifiedDeliveries: snapshot.verifiedDeliveries },
    { centers: 8, challenges: 10, rewards: 1, verifiedDeliveries: 0 });
  assert.deepEqual(snapshot.featuredRewards, [{ id: "digital-guide", title: "Kit digital de reciclaje", cost: 20, kind: "guide-v1" }]);
  assert.equal(snapshot.points.length, 1);
  assert.equal(snapshot.points[0].name, "Zona EcoPulse Los Ángeles");
});

test("public snapshot never selects user identifiers, balances, or private histories", async () => {
  const pool = fakePool();
  const result = await loadPublicImpact(pool);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /clerk_user_id|user_id|userEmail|email|pointsBalance|history|redemptionCode/);
  assert.ok(pool.queries.every(query => !/SELECT\s+\*/i.test(query)));
  assert.ok(pool.queries.every(query => !/FROM users |FROM point_movements |FROM redemptions /i.test(query)));
});
