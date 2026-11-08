import assert from "node:assert/strict";
import test from "node:test";
import { updatePublishedDigitalReward, activateDigitalRedemption, createRewardDraft, fulfillRedemption, publishRewardDraft, loadAdminRedemptions, loadAdminRewards, loadPointMovements, loadRedemptions, loadRewardBalance, loadRewardCapabilities, loadRewards, RewardApiError } from "./reward-api.ts";
import { loadAdminFulfillmentHistory } from "./reward-api.ts";
import { savePhysicalRewardPhoto } from "./reward-api.ts";

test("photo registration preserves authorization fields and rejects mismatched responses",async()=>{
  const input={imageUrl:"https://example.org/photo.jpg",sourceUrl:"https://example.org/permission",photoConfirmed:true};
  const signal=new AbortController().signal;
  await savePhysicalRewardPhoto("https://api.invalid","test-token","reward",input,signal,async(url,options)=>{
    assert.equal(options.method,"PUT");assert.deepEqual(JSON.parse(options.body),input);
    return new Response(JSON.stringify({rewardId:"reward",...input,confirmedAt:"2026-11-07T00:00:00Z"}));
  });
  await assert.rejects(savePhysicalRewardPhoto("https://api.invalid","test-token","reward",input,signal,async()=>new Response(JSON.stringify({rewardId:"other",...input,confirmedAt:"2026-11-07T00:00:00Z"}))),{code:"invalid_reward_photo_response"});
});
test("physical fulfillment transmits the presented pickup code instead of deriving it from the target",async()=>{
  await fulfillRedemption("https://api.invalid","test-token","target","TEST-RECEIPT-001",new AbortController().signal,async(url,options)=>{
    assert.deepEqual(JSON.parse(options.body),{reference:"TEST-RECEIPT-001",pickupCode:"presented-code"});
    return new Response(JSON.stringify({id:"target",replayed:false}));
  },"presented-code");
});

test("administrative fulfillment history paginates authenticated no-store reads and strips identities", async () => {
  const row = { id: "redemption", rewardId: "reward", rewardTitle: "Contract test", cost: 20,
    createdAt: "2026-11-04T09:00:00Z", fulfilledAt: "2026-11-04T10:00:00Z", fulfillmentReference: "RECEIPT-2026-001" };
  for (const cursor of [null, "continuation_cursor"]) {
    const result = await loadAdminFulfillmentHistory("https://api.invalid", "test-token", cursor, new AbortController().signal, async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/api/pilot/admin/redemptions/history");
      assert.equal(parsed.searchParams.get("limit"), "20");
      assert.equal(parsed.searchParams.get("cursor"), cursor);
      assert.equal(options.method, "GET");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return Response.json({ items: [{ ...row, userId: "must_not_be_retained" }], nextCursor: "next_cursor" });
    });
    assert.deepEqual(result, { items: [row], nextCursor: "next_cursor" });
  }
});

test("fulfillment history rejects invalid evidence, dates and cursors instead of showing false records", async () => {
  const call = body => loadAdminFulfillmentHistory("https://api.invalid", "test-token", null, new AbortController().signal, async () => Response.json(body));
  assert.deepEqual(await call({ items: [], nextCursor: null }), { items: [], nextCursor: null });
  const row = { id: "r", rewardId: "w", rewardTitle: "Test", cost: 20, createdAt: "2026-11-04T09:00:00Z", fulfilledAt: "2026-11-04T10:00:00Z", fulfillmentReference: "RECEIPT-2026-001" };
  for (const item of [{ ...row, fulfilledAt: null }, { ...row, fulfilledAt: "not-a-date" }, { ...row, fulfillmentReference: "" }, { ...row, cost: -1 }]) {
    await assert.rejects(call({ items: [item], nextCursor: null }), { code: "invalid_fulfillment_history" });
  }
  await assert.rejects(call({ items: [], nextCursor: "?invalid" }), { code: "invalid_fulfillment_history" });
  await assert.rejects(loadAdminFulfillmentHistory("https://api.invalid", "test-token", "?invalid", new AbortController().signal, async () => { throw Error("must_not_fetch"); }), { code: "invalid_pagination" });
});

test("fulfillment cannot confirm a response for another redemption", async () => {
  await assert.rejects(fulfillRedemption("https://api.invalid", "test-token", "expected", "RECEIPT-2026-001", new AbortController().signal,
    async () => Response.json({ id: "other", replayed: false })), { code: "invalid_fulfillment_response" });
});

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
test("digital delivery is based on a recognized fulfilled asset, not reward ID", async () => {
  const row = { id: "r1", rewardId: "any-reward-id", rewardTitle: "Nature", cost: 10, createdAt: "2026-01-01T00:00:00Z" };
  const { fetcher } = mock({ "/api/pilot/redemptions": [
    { ...row, fulfillmentStatus: "fulfilled", digitalAsset: "nature-v1" },
    { ...row, id: "r2", fulfillmentStatus: "reserved", digitalAsset: "nature-v1" },
    { ...row, id: "r3", fulfillmentStatus: "fulfilled", digitalAsset: "unknown" },
  ] });
  const result = await loadRedemptions("https://ecopulse-3xb4.onrender.com", "token", new AbortController().signal, fetcher);
  assert.deepEqual(result.map(item => item.digitalAsset), ["nature-v1", null, null]);
});
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
  assert.equal((await loadRewardCapabilities(...args)).canPublish,false);
  assert.ok(requests.every(row => row.options.headers.Authorization === "Bearer test-token" && row.options.cache === "no-store"));
});
test("publication sends a draft snapshot and cannot show success without persisted validation", async () => {
  const id="00000000-0000-4000-8000-000000000001";
  const input={expected:{title:"Test",description:"Mock only",cost:20},inventoryRemaining:3,fulfillmentReference:"https://example.org/test-evidence"};
  const body={id,...input.expected,active:true,inventoryRemaining:3,validationRecorded:true,fulfillmentDocumented:true};
  const {fetcher,requests}=mock({[`/api/pilot/admin/rewards/${id}/publish`]:body});
  const result=await publishRewardDraft("https://ecopulse-3xb4.onrender.com","mock-token",id,input,new AbortController().signal,fetcher);
  assert.equal(result.active,true);
  assert.equal(requests[0].options.method,"POST");
  assert.deepEqual(JSON.parse(requests[0].options.body),input);
  const invalid=mock({[`/api/pilot/admin/rewards/${id}/publish`]:{...body,validationRecorded:false}});
  await assert.rejects(publishRewardDraft("https://ecopulse-3xb4.onrender.com","mock-token",id,input,new AbortController().signal,invalid.fetcher),{code:"invalid_reward_publication_response"});
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
import { canRedeemReward, hasRewardInventory } from "./reward-api.ts";

test("redemption requires confirmed positive inventory and sufficient real balance", () => {
  const item = { id: "reward", title: "Contract test", description: "Unit test only", cost: 20, active: true, inventoryRemaining: 1 };
  assert.equal(canRedeemReward(item, true, 20), true);
  assert.equal(canRedeemReward(item, false, 20), false);
  assert.equal(canRedeemReward(item, true, 19), false);
  assert.equal(canRedeemReward(item, true, NaN), false);
  assert.equal(canRedeemReward({ ...item, active: false }, true, 100), false);
  for (const inventoryRemaining of [undefined, null, 0, -1, 0.5, NaN]) {
    const unavailable = { ...item, inventoryRemaining };
    assert.equal(hasRewardInventory(unavailable), false);
    assert.equal(canRedeemReward(unavailable, true, 100), false);
  }
});

test("participant can activate only an owned digital redemption via authenticated endpoint",async()=>{
  const id="00000000-0000-4000-8000-000000000002";
  const signal=new AbortController().signal;
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;
    assert.match(url,new RegExp("/redemptions/"+id+"/activate-download$"));
    assert.equal(options.method,"POST");
    assert.equal(options.headers.Authorization,"Bearer token");
    assert.deepEqual(JSON.parse(options.body),{});
    return new Response(JSON.stringify({id,replayed:false}),{status:200,headers:{"Content-Type":"application/json"}});
  };
  assert.deepEqual(await activateDigitalRedemption("https://api.invalid","token",id,signal,fetcher),{id,replayed:false});
  assert.equal(calls,1);
});
test("legacy reserved redemption retains digitalPending only when server reports it",async()=>{
  const item={id:"a",rewardId:"r",rewardTitle:"Kit digital de reciclaje",cost:20,createdAt:"2026-11-08T00:00:00Z",fulfillmentStatus:"reserved",digitalPending:true};
  const fetcher=async()=>new Response(JSON.stringify([item]),{status:200,headers:{"Content-Type":"application/json"}});
  const data=await loadRedemptions("https://api.invalid","token",new AbortController().signal,fetcher);
  assert.equal(data[0].digitalPending,true);
  assert.equal(data[0].digitalAsset,null);
});

test("admin updates published digital reward description and future cost through authenticated endpoint", async () => {
 const id="e1f00201-0001-4000-8000-000000000001";
 const expected={title:"Kit digital de reciclaje",description:"Viejo texto",cost:20};
 const next={description:"Nueva descripción",cost:25};
 const signal=new AbortController().signal;
 const fetched=async(url,options)=>{
   assert.match(url,/\/admin\/rewards\/e1f00201-0001-4000-8000-000000000001\/published-details$/);
   assert.equal(options.method,"PATCH");
   assert.equal(options.headers.Authorization,"Bearer token");
   assert.deepEqual(JSON.parse(options.body),{expected,next});
   return new Response(JSON.stringify({id,title:expected.title,description:next.description,cost:25,active:false}),{status:200,headers:{"Content-Type":"application/json"}});
 };
 const response=await updatePublishedDigitalReward("https://api.invalid","token",id,expected,next,signal,fetched);
 assert.equal(response.cost,25);
 assert.equal(response.active,false);
});
