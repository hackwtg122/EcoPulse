import test from "node:test";
import assert from "node:assert/strict";
import { parsePhysicalRewardPhoto, recordPhysicalRewardPhoto } from "./rewardPhotos.ts";

const valid = {
  imageUrl: "https://supplier.example/products/steel-bottle.jpg",
  sourceUrl: "https://supplier.example/products/steel-bottle",
  photoConfirmed: true,
};
test("real physical reward photo requires admin attestation, HTTPS and source", () => {
  assert.deepEqual(parsePhysicalRewardPhoto(valid), valid);
  for (const invalid of [
    { ...valid, photoConfirmed: false },
    { ...valid, photoConfirmed: undefined },
    { ...valid, imageUrl: "http://supplier.example/img.jpg" },
    { ...valid, imageUrl: "https://127.0.0.1/image.jpg" },
    { ...valid, imageUrl: "https://supplier.example/image.jpg#fragment" },
    { ...valid, sourceUrl: "https://user:secret@supplier.example/product" },
    { ...valid, sourceUrl: "http://supplier.example/item" },
    { ...valid, extra: "not allowed" },
  ]) assert.throws(() => parsePhysicalRewardPhoto(invalid), { code: "invalid_reward_photo" });
});
test("photo preparation permits a draft without stock, locks actor/product and audits the prior image", async () => {
  const queries=[];
  const pool={ async connect(){return {release(){},async query(raw,params){
    const sql=raw.trim(); queries.push(sql);
    if(sql.startsWith("SELECT role")) return {rows:[{role:"admin"}]};
    if(sql.startsWith("SELECT title")) return {rows:[{title:"Product",description:"Specific model",active:false}]};
    if(sql.startsWith("INSERT INTO reward_photos")) { assert.deepEqual(params.slice(4),["Product","Specific model"]); return {rows:[{imageUrl:valid.imageUrl,sourceUrl:valid.sourceUrl,confirmedAt:new Date()}]}; }
    return {rows:[]};
  }}}};
  await recordPhysicalRewardPhoto(pool,"user_Admin","00000000-0000-4000-8000-000000000001",valid);
  assert.match(queries[1],/FOR SHARE/); assert.match(queries[2],/FOR UPDATE/);
  assert.ok(queries.some(q=>q.startsWith("INSERT INTO reward_photo_events")));
  assert.equal(queries.at(-1),"COMMIT");
});
test("a demoted actor or published reward cannot replace product evidence",async()=>{
  for(const [role,active,code] of [["participant",false,"admin_required"],["admin",true,"reward_photo_requires_draft"]]){
    const queries=[];
    const pool={async connect(){return {release(){},async query(sql){queries.push(sql);return {rows:sql.startsWith("SELECT role")?[{role}]:sql.startsWith("SELECT title")?[{active}]:[]};}}}};
    await assert.rejects(recordPhysicalRewardPhoto(pool,"user_Admin","00000000-0000-4000-8000-000000000001",valid),{code});
    assert.equal(queries.some(q=>q.startsWith("INSERT")),false);
    assert.equal(queries.at(-1),"ROLLBACK");
  }
});
