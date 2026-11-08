import assert from "node:assert/strict";
import test from "node:test";
import { editPublishedDigitalReward } from "./rewardService.ts";
import { digitalAssetCatalog } from "./digitalAssetRegistry.ts";

const asset=digitalAssetCatalog().find(a=>a.key==="guide-v1");
assert.ok(asset);
const id="e1f00201-0001-4000-8000-000000000001";
const expected={title:"Kit digital de reciclaje",description:"Guía original",cost:20};
function fakeDb({role="admin",changed=false,digital=true}={}) {
 const calls=[];
 const client={release(){},async query(sql,params=[]) {
  const statement=sql.trim();calls.push({statement,params});
  if(["BEGIN","COMMIT","ROLLBACK"].includes(statement))return {rows:[]};
  if(statement.startsWith("SELECT role FROM users"))return {rows:role?[{role}]:[]};
  if(statement.startsWith("SELECT id,title,description,cost,active,validated_at"))return {rows:[{
    id,title:expected.title,description:changed?"Other description":expected.description,cost:20,active:false,
    validated_at:new Date(),validated_by:"user_admin",fulfillment_reference:digital?asset.evidenceReference:"https://example.org/physical",
  }]};
  if(statement.startsWith("SELECT set_config"))return {rows:[{set_config:"user_admin"}]};
  if(statement.startsWith("UPDATE rewards"))return {rows:[{
    id,title:expected.title,description:params[1],cost:params[2],active:false,
  }]};
  throw Error("unexpected sql "+statement);
 }};
 return {calls,connect:async()=>client};
}
test("admin edits only digital description and future cost, without changing reward stock or history",async()=>{
 const pool=fakeDb();
 const result=await editPublishedDigitalReward(pool,"user_admin",id,expected,{description:"Nueva guía digital",cost:25});
 assert.equal(result.cost,25);
 assert.equal(pool.calls.at(-1).statement,"COMMIT");
 const update=pool.calls.find(q=>q.statement.startsWith("UPDATE rewards"));
 assert.match(update.statement,/SET description=\$2,cost=\$3/);
 assert.doesNotMatch(update.statement,/inventory_remaining|UPDATE redemptions|point_movements/);
 assert.ok(pool.calls.some(q=>q.statement.startsWith("SELECT set_config")));
});
test("rejected: revoked admin, physical, out-of-date and invalid prices",async()=>{
 for(const [options,code] of [
  [{role:"participant"},"admin_required"],
  [{digital:false},"published_digital_reward_required"],
  [{changed:true},"reward_changed_or_unavailable"],
 ]) {
  const pool=fakeDb(options);
  await assert.rejects(editPublishedDigitalReward(pool,"user_admin",id,expected,{description:"Nueva",cost:25}),{code});
  assert.equal(pool.calls.at(-1).statement,"ROLLBACK");
  assert.ok(!pool.calls.some(q=>q.statement.startsWith("UPDATE rewards")));
 }
 await assert.rejects(editPublishedDigitalReward(fakeDb(),"user_admin",id,expected,{description:"Nueva",cost:-1}),{code:"invalid_reward"});
});
test("unchanged edit is idempotent without new audit events",async()=>{
 const pool=fakeDb();
 const response=await editPublishedDigitalReward(pool,"user_admin",id,expected,{description:expected.description,cost:expected.cost});
 assert.equal(response.unchanged,true);
 assert.equal(pool.calls.at(-1).statement,"COMMIT");
 assert.ok(!pool.calls.some(q=>q.statement.startsWith("UPDATE rewards")||q.statement.startsWith("SELECT set_config")));
});
