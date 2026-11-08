import assert from "node:assert/strict";
import test from "node:test";
import { acceptDeliveryRequest } from "./deliveryAcceptance.ts";

const deliveryId = "00000000-0000-4000-8000-000000000001";
function mockedPool({ status="pending", role="admin", owner="participant_1", acceptedBy=null, requestVersion=2 }={}) {
 const queries=[];
 const client={release(){}, async query(sql,params) {
  const text=sql.trim(); queries.push({text,params});
  if(["BEGIN","COMMIT","ROLLBACK"].includes(text)) return {rows:[]};
  if(text.startsWith("SELECT role FROM users")) return {rows:role?[{role}]:[]};
  if(text.startsWith("SELECT user_id, status, request_version")) return {rows:[{user_id:owner,status,request_version:requestVersion}]};
  if(text.startsWith("SELECT accepted_by, accepted_at")) return {rows:acceptedBy?[{accepted_by:acceptedBy,accepted_at:new Date("2026-11-08T03:00:00Z")}]:[]};
  if(text.startsWith("INSERT INTO delivery_request_acceptances")) return {rows:[{accepted_at:new Date("2026-11-08T03:00:00Z")}]};
  throw Error("unexpected query: "+text);
 }};
 return {queries,connect:async()=>client};
}
test("administrator accepts another student's pending request without receipt, verification or points",async()=>{
 const pool=mockedPool();
 const result=await acceptDeliveryRequest(pool,"admin_1","admin",deliveryId);
 assert.equal(result.replayed,false);
 assert.ok(result.acceptedAt);
 assert.ok(pool.queries.some(q=>q.text.startsWith("INSERT INTO delivery_request_acceptances")));
 assert.ok(!pool.queries.some(q=>/INSERT INTO point_movements|UPDATE deliveries|INSERT INTO verifications/.test(q.text)));
 assert.equal(pool.queries.at(-1).text,"COMMIT");
});
test("replayed acceptance never inserts again",async()=>{
 const pool=mockedPool({acceptedBy:"admin_1"});
 const result=await acceptDeliveryRequest(pool,"admin_1","admin",deliveryId);
 assert.equal(result.replayed,true);
 assert.ok(!pool.queries.some(q=>q.text.startsWith("INSERT")));
});
test("revoked role, cancelled and legacy requests cannot be accepted",async()=>{
 for(const [input,expected] of [
  [{role:"participant"},"verifier_required"],
  [{status:"cancelled"},"delivery_not_pending"],
  [{requestVersion:1},"delivery_details_required"],
 ]) {
  const pool=mockedPool(input);
  await assert.rejects(acceptDeliveryRequest(pool,"admin_1","admin",deliveryId),e=>e.code===expected);
  assert.equal(pool.queries.at(-1).text,"ROLLBACK");
  assert.ok(!pool.queries.some(q=>q.text.startsWith("INSERT")));
 }
});
test("API role snapshot cannot bypass current database role",async()=>{
 const pool=mockedPool({role:"participant"});
 await assert.rejects(acceptDeliveryRequest(pool,"admin_1","admin",deliveryId),{code:"verifier_required"});
 assert.equal(pool.queries.at(-1).text,"ROLLBACK");
});

test("sole administrator can acknowledge own pending digital request without fabricating physical reception", async () => {
 const pool=mockedPool({owner:"admin_1"});
 const result=await acceptDeliveryRequest(pool,"admin_1","admin",deliveryId);
 assert.equal(result.replayed,false);
 assert.ok(pool.queries.some(q=>q.text.startsWith("INSERT INTO delivery_request_acceptances")));
 assert.ok(!pool.queries.some(q=>/INSERT INTO point_movements|UPDATE deliveries|INSERT INTO verifications/.test(q.text)));
});
