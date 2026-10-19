import assert from "node:assert/strict";
import test from "node:test";
import { RewardError, parseRewardDraft, rewardIdForKey, redemptionActionsEnabled } from "./rewardService.ts";

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
