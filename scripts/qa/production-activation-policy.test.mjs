import assert from "node:assert/strict";
import test from "node:test";
import { activateDraftEditing, activateRewardFulfillment, activationMarker, activationLiveMarker, activationRevision, draftFlags, rewardActivationLiveMarker, rewardActivationMarker, rewardActivationRevision, rewardFlags, rewardPolicyReference, safeActivationSnapshot } from "./production-activation-policy.mjs";
import { configureApprovedPointsPolicy, pointsPolicyMarker, pointsPolicyLiveMarker, pointsPolicyRevision } from "./production-activation-policy.mjs";
import { activateVerifierActions, verifierActivationMarker, verifierActivationLiveMarker, verifierActivationRevision, verifierFlags } from "./production-activation-policy.mjs";
import { activateApprovedPoints, pointsActivationMarker, pointsActivationLiveMarker, pointsActivationRevision } from "./production-activation-policy.mjs";
import { activateDetailedDeliveries, deliveryActivationMarker, deliveryActivationLiveMarker, deliveryActivationRevision } from "./production-activation-policy.mjs";

function adapter(initial = []) {
  const environment = new Map(initial), writes = [];
  return { environment, writes, readEnvironment: async () => new Map(environment),
    setVariable: async (key, value) => { writes.push([key, value]); environment.set(key, value); } };
}
test("activation only changes draft flags and marker, never identities, policies or value gates", async () => {
  const api = adapter([["CLERK_SECRET_KEY", "private-sentinel"], ["PILOT_POINTS_ENABLED", "false"]]);
  const result = await activateDraftEditing(api);
  assert.deepEqual(api.writes, [...draftFlags.map(flag => [flag, "true"]), [activationMarker, activationRevision]]);
  assert.equal(api.environment.get("PILOT_POINTS_ENABLED"), "false");
  assert.equal(result.status, "PASS");
  assert.equal(result.deployRequired, true);
  assert.ok(!JSON.stringify(result).includes("private-sentinel"));
  assert.ok(!JSON.stringify(result).includes("CLERK_SECRET_KEY"));
});
test("later deployments preserve operator kill switches after the one-time activation", async () => {
  const api = adapter([[activationMarker, activationRevision], [activationLiveMarker, activationRevision], ...draftFlags.map(flag => [flag, "false"])]);
  const result = await activateDraftEditing(api);
  assert.equal(result.alreadyApplied, true);
  assert.deepEqual(api.writes, []);
  assert.equal(result.deployRequired, false);
});
test("an interrupted deployment must deploy again even if configuration updates already completed", async () => {
  const api = adapter([[activationMarker, activationRevision], ...draftFlags.map(flag => [flag, "true"])]);
  const result = await activateDraftEditing(api);
  assert.equal(result.deployRequired, true);
  assert.deepEqual(api.writes, []);
});
test("a failed update cannot mark the activation complete", async () => {
  const api = adapter();
  let count = 0;
  api.setVariable = async (key, value) => { if (++count === 2) throw new Error("safe-test-failure"); api.environment.set(key, value); };
  await assert.rejects(activateDraftEditing(api));
  assert.equal(api.environment.has(activationMarker), false);
});
test("a silent provider update failure is detected by re-reading the actual configuration", async () => {
  const api = adapter();
  api.setVariable = async () => {};
  await assert.rejects(activateDraftEditing(api), /draft_activation_not_confirmed/);
});
test("evaluation mode is never activated or modified and is refused on this service", async () => {
  const api = adapter([["EVALUATION_MODE_ENABLED", "true"]]);
  await assert.rejects(activateDraftEditing(api), /unexpected_evaluation_service/);
  assert.deepEqual(api.writes, []);
});
test("diagnostics emit only allowlisted flags and closed status values", () => {
  const result = safeActivationSnapshot(new Map([["PILOT_AI_ENABLED", "secret-sentinel"], ["PRIVATE_KEY", "secret-sentinel"]]));
  assert.ok(!JSON.stringify(result).includes("secret-sentinel"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_KEY"));
  assert.deepEqual(result.find(row => row.flag === "PILOT_AI_ENABLED"), { flag: "PILOT_AI_ENABLED", state: "invalid" });
});
test("reward activation enables only the catalog and fulfillment flags plus a policy reference", async () => {
  const api = adapter([["PILOT_POINTS_ENABLED", "false"], ["PILOT_VERIFICATION_ENABLED", "false"], ["PILOT_REWARD_PUBLICATION_ENABLED", "false"]]);
  const result = await activateRewardFulfillment(api);
  assert.deepEqual(api.writes, [...rewardFlags.map(flag => [flag, "true"]), ["REWARD_POLICY_REFERENCE", rewardPolicyReference], [rewardActivationMarker, rewardActivationRevision]]);
  for (const closed of ["PILOT_POINTS_ENABLED", "PILOT_VERIFICATION_ENABLED", "PILOT_REWARD_PUBLICATION_ENABLED"]) {
    assert.equal(api.environment.get(closed), "false");
  }
  assert.equal(result.status, "PASS");
  assert.equal(result.policyConfigured, true);
  assert.equal(result.deployRequired, true);
});
test("reward activation preserves operator kill switches after the one-time activation", async () => {
  const api = adapter([[rewardActivationMarker, rewardActivationRevision], [rewardActivationLiveMarker, rewardActivationRevision],
    ["REWARD_POLICY_REFERENCE", rewardPolicyReference], ...rewardFlags.map(flag => [flag, "false"])]);
  const result = await activateRewardFulfillment(api);
  assert.equal(result.alreadyApplied, true);
  assert.deepEqual(api.writes, []);
  assert.equal(result.deployRequired, false);
});
test("reward activation refuses evaluation mode and never enables points", async () => {
  const api = adapter([["EVALUATION_MODE_ENABLED", "true"], ["PILOT_POINTS_ENABLED", "false"]]);
  await assert.rejects(activateRewardFulfillment(api), /unexpected_evaluation_service/);
  assert.deepEqual(api.writes, []);
  assert.equal(api.environment.get("PILOT_POINTS_ENABLED"), "false");
});
test("an invalid reward policy reference is replaced before the marker is written", async () => {
  const api = adapter([["REWARD_POLICY_REFERENCE", "short"]]);
  await activateRewardFulfillment(api);
  assert.equal(api.environment.get("REWARD_POLICY_REFERENCE"), rewardPolicyReference);
  assert.equal(api.environment.get(rewardActivationMarker), rewardActivationRevision);
});

test("approved points policy configures the rate and cap without enabling transactions", async () => {
  const api = adapter([["PILOT_POINTS_ENABLED", "false"], ["PILOT_VERIFICATION_ENABLED", "false"]]);
  const result = await configureApprovedPointsPolicy(api);
  assert.deepEqual(api.writes, [["POINTS_PER_KG", "20"], ["POINTS_MAX_PER_DELIVERY", "100"], [pointsPolicyMarker, pointsPolicyRevision]]);
  assert.equal(api.environment.get("PILOT_POINTS_ENABLED"), "false");
  assert.equal(api.environment.get("PILOT_VERIFICATION_ENABLED"), "false");
  assert.equal(result.deployRequired, true);
});
test("points policy refuses to change active points and evaluation environments", async () => {
  for (const flag of ["PILOT_POINTS_ENABLED", "EVALUATION_MODE_ENABLED"]) {
    const api = adapter([[flag, "true"]]);
    await assert.rejects(configureApprovedPointsPolicy(api));
    assert.deepEqual(api.writes, []);
  }
});
test("points policy preserves later operator overrides and interrupted deploy requires retry", async () => {
  const api = adapter([[pointsPolicyMarker, pointsPolicyRevision], ["POINTS_PER_KG", "30"]]);
  assert.equal((await configureApprovedPointsPolicy(api)).deployRequired, true);
  assert.deepEqual(api.writes, []);
  api.environment.set(pointsPolicyLiveMarker, pointsPolicyRevision);
  assert.equal((await configureApprovedPointsPolicy(api)).deployRequired, false);
});

test("verifier activation changes only receipt and decision flags", async () => {
  const api = adapter();
  const result = await activateVerifierActions(api);
  assert.deepEqual(api.writes, [...verifierFlags.map(flag => [flag, "true"]), [verifierActivationMarker, verifierActivationRevision]]);
  assert.equal(api.environment.has("PILOT_POINTS_ENABLED"), false);
  assert.equal(api.environment.has("PILOT_DELIVERY_DETAILS_ENABLED"), false);
  assert.equal(result.deployRequired, true);
});
test("verifier activation preserves kill switches and rejects unexpected environments", async () => {
  const done = adapter([[verifierActivationMarker, verifierActivationRevision], [verifierActivationLiveMarker, verifierActivationRevision], ...verifierFlags.map(flag => [flag, "false"])]);
  assert.equal((await activateVerifierActions(done)).deployRequired, false);
  assert.deepEqual(done.writes, []);
  for (const flag of ["EVALUATION_MODE_ENABLED", "PILOT_POINTS_ENABLED"]) {
    const api = adapter([[flag, "true"]]);
    await assert.rejects(activateVerifierActions(api));
    assert.deepEqual(api.writes, []);
  }
});

test("points activation requires the approved policy and verifier gates", async () => {
  const required = [["POINTS_PER_KG", "20"], ["POINTS_MAX_PER_DELIVERY", "100"], ["PILOT_RECEIPT_ENABLED", "true"], ["PILOT_VERIFICATION_ENABLED", "true"]];
  for (const [missing] of required) {
    const api = adapter(required.filter(([key]) => key !== missing));
    await assert.rejects(activateApprovedPoints(api));
    assert.deepEqual(api.writes, []);
  }
  const api = adapter(required);
  assert.equal((await activateApprovedPoints(api)).deployRequired, true);
  assert.deepEqual(api.writes, [["PILOT_POINTS_ENABLED", "true"], [pointsActivationMarker, pointsActivationRevision]]);
});
test("points activation respects later operator kill switches", async () => {
  const api = adapter([[pointsActivationMarker, pointsActivationRevision], [pointsActivationLiveMarker, pointsActivationRevision], ["PILOT_POINTS_ENABLED", "false"]]);
  assert.equal((await activateApprovedPoints(api)).deployRequired, false);
  assert.deepEqual(api.writes, []);
});

test("detailed delivery activation requires protected runtime and preserves kill switches", async () => {
  const blocked = adapter();
  await assert.rejects(activateDetailedDeliveries({ ...blocked, confirmProtectedRuntime: async () => false }), /protected_delivery_runtime_required/);
  assert.deepEqual(blocked.writes, []);
  const api = adapter();
  assert.equal((await activateDetailedDeliveries({ ...api, confirmProtectedRuntime: async () => true })).deployRequired, true);
  assert.deepEqual(api.writes, [["PILOT_DELIVERY_DETAILS_ENABLED", "true"], [deliveryActivationMarker, deliveryActivationRevision]]);
  const done = adapter([[deliveryActivationMarker, deliveryActivationRevision], [deliveryActivationLiveMarker, deliveryActivationRevision], ["PILOT_DELIVERY_DETAILS_ENABLED", "false"]]);
  assert.equal((await activateDetailedDeliveries({ ...done, confirmProtectedRuntime: async () => { throw Error("unexpected"); } })).deployRequired, false);
  assert.deepEqual(done.writes, []);
});
