import assert from "node:assert/strict";
import test from "node:test";
import { digitalAssetForFulfillment } from "./rewardService.ts";
import { listFulfilledRedemptions } from "./rewardService.ts";
import { fulfillRedemption, redeemReward } from "./rewardService.ts";

test("fulfillment rechecks the locked admin role, replays safely and never changes points or inventory", async () => {
  const id = "00000000-0000-4000-8000-000000000001", reference = "RECEIPT-2026-001";
  for (const role of [null, "participant", "verifier", "admin"]) {
    for (const fulfilled of [false, true]) {
      const queries = [];
      const pool = { async connect() { return { release() {}, async query(sql) {
        queries.push(sql);
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
        if (sql.startsWith("SELECT role")) return { rows: role ? [{ role }] : [] };
        if (sql.startsWith("SELECT id,fulfillment_status")) return { rows: [{ id, fulfillment_status: fulfilled ? "fulfilled" : "reserved", fulfillment_reference: fulfilled ? reference : null, fulfilled_by: fulfilled ? "user_Admin" : null }] };
        if (sql.startsWith("UPDATE redemptions")) return { rows: [], rowCount: 1 };
        throw Error("unexpected_query");
      } }; } };
      if (role !== "admin") {
        await assert.rejects(fulfillRedemption(pool, "user_Admin", id, reference), { status: 403, code: "admin_required" });
        assert.equal(queries.at(-1), "ROLLBACK");
        assert.equal(queries.length, 3);
      } else {
        assert.equal((await fulfillRedemption(pool, "user_Admin", id, reference)).replayed, fulfilled);
        assert.equal(queries.at(-1), "COMMIT");
        assert.match(queries[1], /FOR SHARE/);
        assert.match(queries[2], /FOR UPDATE/);
        assert.equal(queries.filter(sql => sql.startsWith("UPDATE")).length, fulfilled ? 0 : 1);
      }
      assert.ok(!queries.some(sql => /point_movements|UPDATE rewards/.test(sql)));
    }
  }
});

test("redemption locks spending and inventory and rolls back all writes if debit fails", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const failDebit of [false, true]) {
    const queries = [];
    const pool = { async connect() { return { release() {}, async query(sql, params) {
      queries.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("SELECT pg_advisory")) return { rows: [] };
      if (sql.startsWith("SELECT clerk_user_id")) return { rows: [{ clerk_user_id: "user_owner" }] };
      if (sql.startsWith("SELECT id,reward_id")) return { rows: [] };
      if (sql.startsWith("SELECT cost,inventory_remaining")) return { rows: [{ cost: 20, inventory_remaining: 1, active: true, fulfillment_reference: "https://example.org/evidence", validated_at: new Date(), validated_by: "user_Admin" }] };
      if (sql.startsWith("SELECT to_regclass('public.reward_photos')")) return { rows: [{ present: true }] };
       if (sql.startsWith("SELECT EXISTS(SELECT 1 FROM public.reward_photos")) return { rows: [{ present: true }] };
       if (sql.startsWith("SELECT coalesce(sum(delta)")) return { rows: [{ balance: "20" }] };
      if (sql.startsWith("INSERT INTO redemptions")) return { rows: [{ id, reward_id: id, cost: 20, fulfillment_status: "reserved" }] };
      if (sql.startsWith("INSERT INTO point_movements")) {
        assert.equal(params[2], -20);
        if (failDebit) throw Object.assign(Error("debit_unavailable"), { code: "XX000" });
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE rewards")) return { rows: [] };
      throw Error("unexpected_query");
    } }; } };
    if (failDebit) {
      await assert.rejects(redeemReward(pool, "user_owner", id, "redemption_contract_key"), { code: "XX000" });
      assert.equal(queries.at(-1).sql, "ROLLBACK");
      assert.ok(!queries.some(q => q.sql.startsWith("UPDATE rewards")));
    } else {
      await redeemReward(pool, "user_owner", id, "redemption_contract_key");
      assert.equal(queries.at(-1).sql, "COMMIT");
      assert.match(queries.find(q => q.sql.startsWith("UPDATE rewards")).sql, /inventory_remaining=inventory_remaining-1/);
    }
    assert.match(queries[1].sql, /pg_advisory_xact_lock/);
    assert.match(queries.find(q => q.sql.startsWith("SELECT cost,inventory_remaining")).sql, /FOR UPDATE/);
  }
});

test("fulfilled redemption history uses stable keyset pagination and never writes", async () => {
  const cursor = { createdAt: new Date("2026-11-04T10:00:00.123Z"), id: "00000000-0000-4000-8000-000000000001" };
  for (const next of [null, cursor]) {
    let calls = 0;
    const rows = [];
    const result = await listFulfilledRedemptions({ async query(sql, params) {
      calls++;
      assert.match(sql, /^SELECT/);
      assert.match(sql, /fulfillment_status='fulfilled'/);
      assert.match(sql, /date_trunc\('milliseconds',r.fulfilled_at\),r.id\)</);
      assert.match(sql, /ORDER BY date_trunc\('milliseconds',r.fulfilled_at\) DESC,r.id DESC LIMIT \$3/);
      assert.ok(!sql.includes("user_id"), "history must not select participant identity");
      assert.deepEqual(params, [next?.createdAt ?? null, next?.id ?? null, 21]);
      return { rows };
    } }, 21, next);
    assert.equal(result, rows);
    assert.equal(calls, 1);
  }
});

test("digital fulfillment exposes only an explicitly delivered known asset", () => {
  assert.equal(digitalAssetForFulfillment("fulfilled", "digital:ecopulse/nature-v1"), "nature-v1");
  assert.equal(digitalAssetForFulfillment("fulfilled", "digital:ecopulse/guide-v1"), "guide-v1");
  assert.equal(digitalAssetForFulfillment("reserved", "digital:ecopulse/nature-v1"), null);
  assert.equal(digitalAssetForFulfillment("fulfilled", "https://example.org/audit"), null);
  assert.equal(digitalAssetForFulfillment("fulfilled", "digital:ecopulse/unknown"), null);
});
import { RewardError, hasRewardFulfillmentEvidence, parseRewardDraft, parseRewardPublication, publishRewardDraft, rewardPublicationEnabled, rewardIdForKey, redemptionActionsEnabled } from "./rewardService.ts";

const draft = { title: "Test reward", description: "Mock fixture only", cost: 20 };
const publication = { expected: draft, inventoryRemaining: 5, fulfillmentReference: "https://example.org/test-fulfillment" };
const rewardId = "00000000-0000-4000-8000-000000000001";
test("only documented and validated rewards can be offered for redemption", () => {
  assert.equal(hasRewardFulfillmentEvidence("https://example.org/evidence", new Date(), "user_Admin"), true);
  for (const ref of ["academic:ecopulse/recompensa-01", null, "https://localhost/a", "https://user:pass@example.org/a"]) {
    assert.equal(hasRewardFulfillmentEvidence(ref, new Date(), "user_Admin"), false);
  }
  assert.equal(hasRewardFulfillmentEvidence("https://example.org/evidence", null, "user_Admin"), false);
  assert.equal(hasRewardFulfillmentEvidence("https://example.org/evidence", new Date(), null), false);
});
function publicationPool(row, actorRole = "admin") {
  const queries = [];
  return { queries, async connect() { return { release() {}, async query(text, params) {
    queries.push(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
    if (text.startsWith("SELECT role FROM users")) return { rows: [{ role: actorRole }] };
    if (text.startsWith("SELECT id,title")) return { rows: row ? [row] : [] };
    if (text.startsWith("UPDATE rewards SET inventory_remaining")) {
      assert.deepEqual(params, [rewardId, 5, publication.fulfillmentReference, "user_TestAdmin"]);
      return { rows: [{ ...draft, id: rewardId, active: true, inventoryRemaining: 5, fulfillmentDocumented: true, validationRecorded: true }] };
    }
    throw new Error("unexpected_mock_query");
  } }; } };
}
test("publication requires inventory, exact draft and public HTTPS evidence; actor fields are forbidden", () => {
  assert.deepEqual(parseRewardPublication(publication), publication);
  for (const body of [{ ...publication, inventoryRemaining: 0 }, { ...publication, inventoryRemaining: 100001 },
    { ...publication, inventoryRemaining: 1.1 }, { ...publication, validatedBy: "user_Other" },
    { ...publication, expected: undefined }, { ...publication, fulfillmentReference: "academic:fixture" },
    { ...publication, fulfillmentReference: "https://user:secret@example.org/test" },
    { ...publication, fulfillmentReference: "https://127.0.0.1/test" }, { ...publication, fulfillmentReference: "https://example.local/test" }]) {
    assert.throws(() => parseRewardPublication(body), error => error instanceof RewardError && error.status === 400);
  }
});
test("publication stays closed without an explicit flag, approved policy and every prerequisite", () => {
  const flags = { publication: "true", admin: "true", rewards: "true", fulfillment: "true", policyReference: "approved-test-policy" };
  assert.equal(rewardPublicationEnabled(flags, true), true);
  assert.equal(rewardPublicationEnabled(flags, false), false);
  for (const field of Object.keys(flags)) assert.equal(rewardPublicationEnabled({ ...flags, [field]: undefined }, true), false);
});
test("publication locks actor and draft and commits persisted validation atomically", async () => {
  const pool = publicationPool({ ...draft, id: rewardId, active: false, inventory_remaining: null, fulfillment_reference: null, validated_by: null, validated_at: null });
  const result = await publishRewardDraft(pool, "user_TestAdmin", rewardId, parseRewardPublication(publication));
  assert.equal(result.reward.active, true);
  assert.equal(result.replayed, false);
  assert.ok(pool.queries[1].includes("FOR SHARE"));
  assert.ok(pool.queries[2].includes("FOR UPDATE"));
  assert.equal(pool.queries.at(-1), "COMMIT");
});
test("retry never replenishes depleted inventory or republishes an exhausted reward", async () => {
  for (const active of [true, false]) {
    const pool = publicationPool({ ...draft, id: rewardId, active, inventory_remaining: 0, fulfillment_reference: publication.fulfillmentReference, validated_by: "user_TestAdmin", validated_at: new Date() });
    await assert.rejects(publishRewardDraft(pool, "user_TestAdmin", rewardId, publication), error => error.code === "reward_already_validated");
    assert.ok(!pool.queries.some(q => q.startsWith("UPDATE")));
    assert.equal(pool.queries.at(-1), "ROLLBACK");
  }
});
test("unchanged published reward replays without UPDATE, demoted actor and changed draft are rejected", async () => {
  const row = { ...draft, id: rewardId, active: true, inventory_remaining: 5, fulfillment_reference: publication.fulfillmentReference, validated_by: "user_TestAdmin", validated_at: new Date() };
  const replay = publicationPool(row);
  assert.equal((await publishRewardDraft(replay, "user_TestAdmin", rewardId, publication)).replayed, true);
  assert.ok(!replay.queries.some(q => q.startsWith("UPDATE")));
  await assert.rejects(publishRewardDraft(publicationPool(row, "participant"), "user_TestAdmin", rewardId, publication), error => error.code === "admin_required");
  await assert.rejects(publishRewardDraft(publicationPool({ ...row, cost: 50 }), "user_TestAdmin", rewardId, publication), error => error.code === "reward_changed_or_unavailable");
});

test("reward drafts reject extra fields and invalid cost", () => {
  assert.deepEqual(parseRewardDraft({ title: "  Semillas  ", description: "  Convenio validado  ", cost: 20 }),
    { title: "Semillas", description: "Convenio validado", cost: 20 });
  assert.throws(() => parseRewardDraft({ title:"A", description:"B", cost:0 }), error => error instanceof RewardError && error.code === "invalid_reward");
  assert.throws(() => parseRewardDraft({ title:"A", description:"B", cost:10, active:true }), error => error instanceof RewardError && error.code === "unexpected_fields");
});
test("draft idempotency is stable per actor and key", () => {
  const id = rewardIdForKey("actor_a","same_key_123");
  assert.equal(id,rewardIdForKey("actor_a","same_key_123"));
  assert.notEqual(id,rewardIdForKey("actor_b","same_key_123"));
  assert.throws(() => rewardIdForKey("actor_a","short"), error => error instanceof RewardError);
});
test("canje remains disabled without all policy gates and migration", () => {
  const flags={ rewards:"true",points:"true",fulfillment:"true",policyReference:"approved-policy-001" };
  assert.equal(redemptionActionsEnabled(flags,false),false);
  assert.equal(redemptionActionsEnabled({ ...flags, policyReference:"" },true),false);
  assert.equal(redemptionActionsEnabled({ ...flags, rewards:"false" },true),false);
  assert.equal(redemptionActionsEnabled({ ...flags, points:"false" },true),false);
  assert.equal(redemptionActionsEnabled({ ...flags, fulfillment:"false" },true),false);
  assert.equal(redemptionActionsEnabled(flags,true),true);
});
