import assert from "node:assert/strict";
import test from "node:test";
import { ownedDigitalAsset } from "./digitalAssets.ts";

const id = "00000000-0000-4000-8000-000000000001";
test("digital resource requires owner and fulfilled recognized reference", async () => {
  let row = { fulfillment_status: "fulfilled", fulfillment_reference: "digital:ecopulse/nature-v1" };
  const pool = { async query(sql, params) { assert.match(sql, /user_id=\$2/); assert.deepEqual(params, [id, "owner"]); return { rows: row ? [row] : [] }; } };
  assert.equal((await ownedDigitalAsset(pool, "owner", id)).contentType, "image/svg+xml");
  row = { fulfillment_status: "reserved", fulfillment_reference: "digital:ecopulse/nature-v1" };
  assert.equal(await ownedDigitalAsset(pool, "owner", id), null);
  row = null;
  assert.equal(await ownedDigitalAsset(pool, "owner", id), null);
  assert.equal(await ownedDigitalAsset(pool, "owner", "bad"), null);
});

test("fulfilled guide returns a complete PDF to its owner", async () => {
  const pool = { async query() { return { rows: [{ fulfillment_status: "fulfilled", fulfillment_reference: "digital:ecopulse/guide-v1" }] }; } };
  const asset = await ownedDigitalAsset(pool, "owner", id);
  assert.equal(asset.contentType, "application/pdf");
  assert.ok(Buffer.isBuffer(asset.content));
  assert.match(asset.content.toString("ascii"), /^%PDF-1\.4\n/);
  assert.match(asset.content.toString("ascii"), /%%EOF\n$/);
});
