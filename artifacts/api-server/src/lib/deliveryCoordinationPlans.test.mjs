import assert from "node:assert/strict";
import test from "node:test";
import { parseHandoffDetails, planDeliveryHandoff } from "./deliveryCoordinationPlans.ts";
const id="00000000-0000-4000-8000-000000000001";
function request() {
 return { pointId:"00000000-0000-4000-8000-000000000002", handoffAt:new Date(Date.now()+86400000).toISOString(), note:"Llevar material separado" };
}
function mock({role="admin",status="pending",version=2,accepted=true,prior=null}={}) {
 const calls=[];
 const client={release(){},async query(sql,params){
  const q=sql.trim();calls.push({q,params});
  if(["BEGIN","COMMIT","ROLLBACK"].includes(q)) return {rows:[]};
  if(q.startsWith("SELECT role FROM users")) return {rows:[{role}]};
  if(q.startsWith("SELECT d.status")) return {rows:[{status,request_version:version,accepted_at:accepted?new Date():null}]};
  if(q.startsWith("SELECT address, validation_reference")) return {rows:[{address:"Zona EcoPulse Los Ángeles, Montería — punto de entrega por coordinar",validation_reference:"admin-declaration:v1",validated_by:"admin_1",validated_at:new Date()}]};
  if(q.startsWith("SELECT count(*)::int AS total")) return {rows:[{total:1,unsupported:0}]};
  if(q.startsWith("SELECT plan_hash")) return {rows:prior?[prior]:[]};
  if(q.startsWith("INSERT INTO delivery_coordination_plans")) return {rows:[{handoff_address:params[3],handoff_at:new Date(params[4]),note:params[5],created_at:new Date()}]};
  throw new Error("Unexpected database operation "+q);
 }};
 return {calls,connect:async()=>client};
}
test("parsing requires exact address and future time, with no invented default",()=>{
 const v=parseHandoffDetails(request()); assert.match(v.pointId,/^[0-9a-f-]{36}$/);
 for(const bad of [{...request(),pointId:"bad"},{...request(),handoffAt:"2020-01-01T00:00:00Z"},{...request(),note:"x".repeat(501)},{...request(),confirmedReceipt:true}]) {
   assert.throws(()=>parseHandoffDetails(bad),{status:400});
 }
});
test("admin plans pending accepted digital delivery without physical verification or points",async()=>{
 const p=mock(); const v=await planDeliveryHandoff(p,"admin_1","admin",id,request());
 assert.equal(v.replayed,false);
 assert.ok(p.calls.some(x=>x.q.startsWith("INSERT INTO delivery_coordination_plans")));
 assert.ok(!p.calls.some(x=>/UPDATE deliveries|INSERT INTO verifications|point_movements/i.test(x.q)));
 assert.equal(p.calls.at(-1).q,"COMMIT");
});
test("self-owned coordination can be planned but only accepted active requests",async()=>{
 const p=mock({accepted:false});
 await assert.rejects(planDeliveryHandoff(p,"admin_1","admin",id,request()),{code:"delivery_not_accepted"});
 assert.equal(p.calls.at(-1).q,"ROLLBACK");
});
test("role revalidated inside transaction and deliveries already received rejected",async()=>{
 for(const [opts,err] of [[{role:"participant"},"verifier_required"],[{status:"received"},"delivery_not_pending"],[{version:1},"delivery_not_accepted"]]){
  const p=mock(opts);
  await assert.rejects(planDeliveryHandoff(p,"admin_1","admin",id,request()),{code:err});
  assert.equal(p.calls.at(-1).q,"ROLLBACK");
 }
});

test("rejects a point that does not accept requested materials", async () => {
 const pool=mock();
 const original=pool.connect;
 pool.connect=async()=>{
  const client=await original();
  const query=client.query;
  client.query=async(sql,params)=>sql.trim().startsWith("SELECT count(*)::int AS total")
    ? {rows:[{total:1,unsupported:1}]} : query(sql,params);
  return client;
 };
 await assert.rejects(planDeliveryHandoff(pool,"admin_1","admin",id,request()),{code:"handoff_materials_unavailable"});
 assert.ok(!pool.calls.some(x=>x.q.startsWith("INSERT INTO delivery_coordination_plans")));
});
test("rejects inactive or unverified catalog point",async()=>{
 const pool=mock();
 const original=pool.connect;
 pool.connect=async()=>{
  const client=await original(); const query=client.query;
  client.query=async(sql,params)=>sql.trim().startsWith("SELECT address, validation_reference")
    ? {rows:[]} : query(sql,params);
  return client;
 };
 await assert.rejects(planDeliveryHandoff(pool,"admin_1","admin",id,request()),{code:"handoff_point_unavailable"});
});
