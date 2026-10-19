import assert from "node:assert/strict";
import test from "node:test";
import { createRewardDraft, fulfillRedemption, loadAdminRedemptions, loadAdminRewards, loadPointMovements, loadRedemptions, loadRewardBalance, loadRewardCapabilities, loadRewards, RewardApiError } from "./reward-api.ts";

function mock(routes) {
  const requests=[];
  const fetcher=async (url,options) => {
    requests.push({url,options});
    const path=new URL(url).pathname;
    const result=routes[path];
    return { ok: Boolean(result), status: result ? 200 : 404, async json(){ return result ?? {error:"not_found"}; } };
  };
  return {fetcher,requests};
}
test("rewards client reads only authenticated server data", async () => {
  const {fetcher,requests}=mock({
    "/api/pilot/rewards":[],
    "/api/pilot/redemptions":[],
    "/api/pilot/balance":{balance:0},
    "/api/pilot/rewards/capabilities":{canRedeem:false,canManageDrafts:false,canFulfill:false,schemaReady:false},
  });
  const args=["http://127.0.0.1:5001","test-token",new AbortController().signal,fetcher];
  assert.deepEqual(await loadRewards(...args),[]);
  assert.deepEqual(await loadRedemptions(...args),[]);
  assert.equal(await loadRewardBalance(...args),0);
  assert.equal((await loadRewardCapabilities(...args)).canRedeem,false);
  assert.equal((await loadRewardCapabilities(...args)).canFulfill,false);
  assert.ok(requests.every(row => row.options.headers.Authorization === "Bearer test-token" && row.options.cache === "no-store"));
});
test("draft creation sends only permitted fields and one idempotency key", async () => {
  const id="123e4567-e89b-42d3-a456-426614174000";
  const {fetcher,requests}=mock({"/api/pilot/admin/rewards":{id,title:"Draft",description:"Verified later",cost:10,active:false}});
  const result=await createRewardDraft("http://127.0.0.1:5001","test-token",{title:"Draft",description:"Verified later",cost:10},"draft_key_123",new AbortController().signal,fetcher);
  assert.equal(result.active,false);
  assert.equal(requests[0].options.headers["Idempotency-Key"],"draft_key_123");
  assert.deepEqual(JSON.parse(requests[0].options.body),{title:"Draft",description:"Verified later",cost:10});
});
test("malformed rewards cannot be rendered as real catalog items", async () => {
  const {fetcher}=mock({"/api/pilot/rewards":[{id:"x",title:"Fake",description:"Wrong",cost:"ten"}]});
  await assert.rejects(loadRewards("http://127.0.0.1:5001","test-token",new AbortController().signal,fetcher),error => error instanceof RewardApiError && error.status === 502);
});
test("admin redemptions and fulfillment use authenticated calls", async () => {
  const {fetcher,requests}=mock({
    "/api/pilot/admin/redemptions":[{id:"r1",rewardId:"w1",rewardTitle:"Prize",cost:10,createdAt:"2026-01-01T00:00:00Z",fulfillmentStatus:"reserved"}],
    "/api/pilot/admin/redemptions/r1/fulfill":{id:"r1",replayed:false},
  });
  const redemptions=await loadAdminRedemptions("http://127.0.0.1:5001","admin-token",new AbortController().signal,fetcher);
  assert.equal(redemptions[0].fulfillmentStatus,"reserved");
  const result=await fulfillRedemption("http://127.0.0.1:5001","admin-token","r1","ref:approved-123456",new AbortController().signal,fetcher);
  assert.equal(result.replayed,false);
  assert.equal(requests[1].options.method,"POST");
  assert.equal(requests[1].options.headers.Authorization,"Bearer admin-token");
});
test("point history is server scoped and rejects malformed movements", async () => {
  const {fetcher,requests}=mock({"/api/pilot/point-movements":[{id:"movement-1",delta:20,kind:"delivery",createdAt:"2026-10-18T00:00:00Z"}]});
  const result=await loadPointMovements("http://127.0.0.1:5001","user-token",new AbortController().signal,fetcher);
  assert.equal(result[0].delta,20);
  assert.equal(requests[0].options.headers.Authorization,"Bearer user-token");
  const invalid=mock({"/api/pilot/point-movements":[{id:"movement-2",delta:"100",kind:"delivery",createdAt:"2026-10-18T00:00:00Z"}]});
  await assert.rejects(loadPointMovements("http://127.0.0.1:5001","user-token",new AbortController().signal,invalid.fetcher),{code:"invalid_movement_response"});
});
