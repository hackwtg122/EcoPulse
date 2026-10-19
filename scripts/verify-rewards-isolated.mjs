import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { RewardError, createRewardDraft, editRewardDraft, fulfillRedemption, hasRewardFulfillmentSchema, parseRewardDraft, redeemReward, redemptionActionsEnabled } from "../artifacts/api-server/src/lib/rewardService.ts";

const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error("TEST_DATABASE_URL required");
const url = new URL(target);
if (url.hostname !== "127.0.0.1" || url.port !== "55434" || url.pathname !== "/ecopulse_test" || url.username !== "ecopulse_test_admin") {
  throw new Error("Refusing to test outside isolated PostgreSQL");
}
const admin = new pg.Pool({ connectionString: target, max: 12 });
const password = randomBytes(32).toString("hex");
const appUrl = new URL(url);
appUrl.username = "ecopulse_reward_test_app";
appUrl.password = password;
const app = new pg.Pool({ connectionString: appUrl.toString(), max: 12 });
const owner = "synthetic_reward_owner";
const other = "synthetic_other_user";
try {
  // 0002_catalog_validation references the runtime role in grants. Create it only inside this disposable cluster.
  await admin.query("CREATE ROLE ecopulse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  await migrate(drizzle(admin), { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/db/drizzle") });
  assert.equal(await hasRewardFulfillmentSchema(admin), true);
  const migrationCount = await admin.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations");
  assert.equal(migrationCount.rows[0].count, 4);
  await admin.query("INSERT INTO users (clerk_user_id,role) VALUES ($1,'participant'),($2,'admin')", [owner,other]);
  await assert.rejects(admin.query(`INSERT INTO rewards (id,title,description,cost,active) VALUES ($1,'invalid','invalid',5,true)`, [randomUUID()]), error => error?.code === "23514");
  await admin.query(`CREATE ROLE ecopulse_reward_test_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query(`REVOKE ALL ON DATABASE ecopulse_test FROM ecopulse_reward_test_app; GRANT CONNECT ON DATABASE ecopulse_test TO ecopulse_reward_test_app;
    REVOKE ALL ON SCHEMA public FROM ecopulse_reward_test_app; GRANT USAGE ON SCHEMA public TO ecopulse_reward_test_app;
    GRANT SELECT ON users,rewards,redemptions,point_movements TO ecopulse_reward_test_app;
    GRANT INSERT ON redemptions,point_movements TO ecopulse_reward_test_app;
    GRANT INSERT (id,title,description,cost) ON rewards TO ecopulse_reward_test_app;
    GRANT UPDATE (title,description,cost,inventory_remaining,active,updated_at) ON rewards TO ecopulse_reward_test_app;
    GRANT UPDATE (fulfillment_status,fulfillment_reference,fulfilled_by,fulfilled_at) ON redemptions TO ecopulse_reward_test_app;`);
  const draft = parseRewardDraft({ title: "Synthetic reward", description: "Isolated test only", cost: 8 });
  const created = await Promise.all([createRewardDraft(app,other,"reward_test_same_key",draft),createRewardDraft(app,other,"reward_test_same_key",draft)]);
  assert.deepEqual(created.map(result => result.replayed).sort(), [false,true]);
  assert.equal(created[0].reward.id,created[1].reward.id);
  await assert.rejects(createRewardDraft(app,other,"reward_test_same_key",{ ...draft,cost:9 }),error => error instanceof RewardError && error.code === "idempotency_key_reused");
  const edited = await editRewardDraft(app,created[0].reward.id,draft,{ ...draft,title:"Edited synthetic reward" });
  assert.equal(edited.title,"Edited synthetic reward");
  await assert.rejects(editRewardDraft(app,created[0].reward.id,draft,draft),error => error instanceof RewardError && error.code === "reward_changed_or_unavailable");
  await assert.rejects(app.query("DELETE FROM rewards WHERE id=$1",[created[0].reward.id]),error => error?.code === "42501");
  const rewardId = randomUUID();
  await admin.query(`INSERT INTO rewards (id,title,description,cost,active,inventory_remaining,fulfillment_reference,validated_by,validated_at)
    VALUES ($1,'Synthetic only','Not a real partner',8,true,2,'synthetic-validation-ref',$2,now())`,[rewardId,other]);
  await assert.rejects(app.query("UPDATE rewards SET title='fraud' WHERE id=$1",[rewardId]),error => error?.code === "23514");
  await admin.query("INSERT INTO point_movements (id,user_id,delta,kind,source_id) VALUES ($1,$2,20,'delivery',$3)",[randomUUID(),owner,randomUUID()]);
  const userPrivileges = await app.query("SELECT has_table_privilege(current_user,'users','UPDATE') AS can_update_users");
  assert.equal(userPrivileges.rows[0].can_update_users, false);
  await admin.query(`CREATE FUNCTION public.reject_synthetic_stock_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic rollback check' USING ERRCODE = 'P0001'; END $$`);
  await admin.query("CREATE TRIGGER synthetic_stock_failure BEFORE UPDATE ON rewards FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_stock_update()");
  await assert.rejects(redeemReward(app,owner,rewardId,"rollback_test_key_123"), error => error?.code === "P0001");
  await admin.query("DROP TRIGGER synthetic_stock_failure ON rewards");
  await admin.query("DROP FUNCTION public.reject_synthetic_stock_update()");
  const rollback = await admin.query("SELECT (SELECT count(*)::int FROM redemptions) redemptions,(SELECT count(*)::int FROM point_movements WHERE kind='redemption') debits,(SELECT inventory_remaining FROM rewards WHERE id=$1) stock",[rewardId]);
  assert.deepEqual(rollback.rows[0],{ redemptions:0,debits:0,stock:2 });
  assert.equal(redemptionActionsEnabled({ rewards:"false",points:"true",fulfillment:"true",policyReference:"synthetic-policy-001" },true),false);
  assert.equal(redemptionActionsEnabled({ rewards:"true",points:"true",fulfillment:"true",policyReference:"synthetic-policy-001" },true),true);
  const sameKey = await Promise.all([redeemReward(app,owner,rewardId,"redeem_same_key_123"),redeemReward(app,owner,rewardId,"redeem_same_key_123")]);
  assert.deepEqual(sameKey.map(result => result.replayed).sort(),[false,true]);
  await assert.rejects(redeemReward(app,other,rewardId,"redeem_other_user"),error => error instanceof RewardError && error.code === "insufficient_points");
  const second = await Promise.allSettled([redeemReward(app,owner,rewardId,"redeem_next_one_123"),redeemReward(app,owner,rewardId,"redeem_next_two_123")]);
  assert.equal(second.filter(result => result.status === "fulfilled").length,1);
  assert.equal(second.filter(result => result.status === "rejected").length,1);
  const fulfilledId = sameKey[0].redemption.id;
  assert.equal((await fulfillRedemption(app,other,fulfilledId,"synthetic-proof-001")).replayed,false);
  assert.equal((await fulfillRedemption(app,other,fulfilledId,"synthetic-proof-001")).replayed,true);
  await assert.rejects(fulfillRedemption(app,other,fulfilledId,"synthetic-proof-002"),error => error instanceof RewardError && error.code === "already_fulfilled");
  const state = await admin.query(`SELECT (SELECT count(*)::int FROM redemptions) redemptions,
    (SELECT inventory_remaining FROM rewards WHERE id=$1) inventory,
    (SELECT active FROM rewards WHERE id=$1) active,
    (SELECT count(*)::int FROM point_movements WHERE kind='redemption') debits,
    (SELECT coalesce(sum(delta),0)::int FROM point_movements WHERE user_id=$2) balance`,[rewardId,owner]);
  assert.deepEqual(state.rows[0],{ redemptions:2,inventory:0,active:false,debits:2,balance:4 });
  console.log(JSON.stringify({ database:"isolated ecopulse_test", migrations:4, draftIdempotency:true,
    activeRewardProtected:true, concurrentCanjes:"one-per-remaining-stock", accountIsolation:true,
    balanceFromMovements:true, rollbackAtomicity:true, noUserUpdatePrivilege:true, fulfillmentReplay:true, mainDatabaseTouched:false, credentialsPrinted:false }));
} finally { await app.end(); await admin.end(); }
