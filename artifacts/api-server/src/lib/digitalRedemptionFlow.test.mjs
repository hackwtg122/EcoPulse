import assert from "node:assert/strict";
import test from "node:test";
import { activateOwnedDigitalDownload, redeemReward } from "./rewardService.ts";
import { digitalAssetCatalog } from "./digitalAssetRegistry.ts";

const rewardId="00000000-0000-4000-8000-000000000001";
const redemptionId="00000000-0000-4000-8000-000000000002";
const owner="user_participant";
const guide=digitalAssetCatalog().find(x=>x.key==="guide-v1");
assert.ok(guide, "known server-controlled digital asset required");

function digitalPool({ status="reserved", assetReference=guide.evidenceReference, priorReference=null, debit=true, ownerFound=true, physical=false }={}) {
 const calls=[];
 const client={
  release(){},
  async query(raw,params=[]) {
   const sql=raw.trim();
   calls.push({sql,params});
   if(["BEGIN","COMMIT","ROLLBACK"].includes(sql) || sql.startsWith("SELECT pg_advisory")) return {rows:[]};
   if(sql.startsWith("SELECT clerk_user_id")) return {rows:ownerFound?[{clerk_user_id:owner}]:[]};
   if(sql.startsWith("SELECT id,reward_id,cost,created_at,fulfillment_status FROM redemptions")) return {rows:[]};
   if(sql.startsWith("SELECT cost,inventory_remaining")) return {rows:[{
    cost:20,inventory_remaining:1,active:true,validated_at:new Date(),validated_by:"user_Admin",
    fulfillment_reference:physical?"https://example.org/physical-proof":guide.evidenceReference,
   }]};
   if(sql.startsWith("SELECT to_regclass")) return {rows:[{present:true}]};
   if(sql.startsWith("SELECT EXISTS(SELECT 1 FROM public.reward_photos")) return {rows:[{present:true}]};
   if(sql.startsWith("SELECT coalesce(sum(delta)")) return {rows:[{balance:"20"}]};
   if(sql.startsWith("INSERT INTO redemptions")) return {rows:[{id:redemptionId,fulfillment_status:sql.includes("'fulfilled'")?"fulfilled":"reserved"}]};
   if(sql.startsWith("INSERT INTO point_movements")) return {rows:[]};
   if(sql.startsWith("UPDATE rewards SET inventory_remaining")) return {rows:[]};
   if(sql.startsWith("SELECT d.id,d.cost,d.fulfillment_status")) {
    if(!ownerFound) return {rows:[]};
    return {rows:[{id:redemptionId,cost:20,fulfillment_status:status,fulfillment_reference:priorReference,reward_reference:assetReference}]};
   }
   if(sql.startsWith("SELECT EXISTS (")) return {rows:[{present:debit}]};
   if(sql.startsWith("UPDATE redemptions")) return {rows:[],rowCount:1};
   throw Error("Unexpected SQL: "+sql);
  },
 };
 return {calls,async connect(){return client}};
}

test("a legitimate digital reward is atomically delivered with one debit and inventory decrement",async()=>{
 const pool=digitalPool();
 const result=await redeemReward(pool,owner,rewardId,"test_digital_key_001");
 assert.equal(result.redemption.fulfillment_status,"fulfilled");
 const insert=pool.calls.find(c=>c.sql.startsWith("INSERT INTO redemptions"));
 assert.match(insert.sql,/fulfilled_by,fulfilled_at/);
 assert.equal(insert.params.at(-1),guide.fulfillmentReference);
 assert.equal(pool.calls.filter(c=>c.sql.startsWith("INSERT INTO point_movements")).length,1);
 assert.equal(pool.calls.filter(c=>c.sql.startsWith("UPDATE rewards SET inventory_remaining")).length,1);
 assert.equal(pool.calls.at(-1).sql,"COMMIT");
});
test("physical rewards remain reserved and cannot masquerade as digital",async()=>{
 const pool=digitalPool({physical:true});
 const result=await redeemReward(pool,owner,rewardId,"test_physical_key_002");
 assert.equal(result.redemption.fulfillment_status,"reserved");
 assert.doesNotMatch(pool.calls.find(c=>c.sql.startsWith("INSERT INTO redemptions")).sql,/fulfilled_by/);
});
test("owner activates a prior digital reservation without another debit or stock mutation",async()=>{
 const pool=digitalPool();
 const result=await activateOwnedDigitalDownload(pool,owner,redemptionId);
 assert.equal(result.replayed,false);
 const sqls=pool.calls.map(c=>c.sql);
 assert.equal(sqls.filter(sql=>sql.startsWith("UPDATE redemptions")).length,1);
 assert.ok(!sqls.some(sql=>/INSERT INTO point_movements|UPDATE rewards SET/.test(sql)));
 assert.equal(pool.calls.at(-1).sql,"COMMIT");
 assert.equal(pool.calls.find(c=>c.sql.startsWith("UPDATE redemptions")).params[1],guide.fulfillmentReference);
});
test("activation is replay-safe after successful completion",async()=>{
 const pool=digitalPool({status:"fulfilled",priorReference:guide.fulfillmentReference});
 const result=await activateOwnedDigitalDownload(pool,owner,redemptionId);
 assert.equal(result.replayed,true);
 assert.equal(pool.calls.filter(c=>c.sql.startsWith("UPDATE")).length,0);
});
test("activation forbids another person's redemption, physical rewards, and unmatched debit",async()=>{
 for(const [opts,code] of [
  [{ownerFound:false},"redemption_not_found"],
  [{assetReference:"https://example.org/physical"},"digital_asset_unavailable"],
  [{assetReference:"https://example.org/forged"},"digital_asset_unavailable"],
  [{debit:false},"redemption_debit_unverified"],
 ]) {
  const pool=digitalPool(opts);
  await assert.rejects(activateOwnedDigitalDownload(pool,owner,redemptionId),{code});
  assert.equal(pool.calls.at(-1).sql,"ROLLBACK");
  assert.equal(pool.calls.filter(c=>c.sql.startsWith("UPDATE")).length,0);
 }
});
