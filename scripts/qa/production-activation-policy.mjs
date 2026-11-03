import assert from "node:assert/strict";

// Owner-authorized, one-time activation of draft editing only. This list cannot
// publish catalog entries, award value, record receipts or change identities.
export const activationRevision = "congress-draft-editing-v1";
export const activationMarker = "ECOPULSE_ACTIVATION_REVISION";
export const activationLiveMarker = "ECOPULSE_ACTIVATION_LIVE_REVISION";
export const draftFlags = Object.freeze(["PILOT_CATALOG_ADMIN_ENABLED", "PILOT_REWARD_ADMIN_ENABLED"]);

// Owner-authorized activation of the reward catalog and fulfillment queue. It
// does not enable point accrual, redemptions, reward publication or catalog
// publication, so no value can be created or spent by this step.
export const rewardActivationRevision = "congress-reward-fulfillment-v1";
export const rewardActivationMarker = "ECOPULSE_REWARD_ACTIVATION_REVISION";
export const rewardActivationLiveMarker = "ECOPULSE_REWARD_ACTIVATION_LIVE_REVISION";
export const rewardPolicyReference = "ecopulse://policy/reward-fulfillment-v1";
export const rewardFlags = Object.freeze(["PILOT_REWARDS_ENABLED", "PILOT_REWARD_FULFILLMENT_ENABLED"]);
const rewardPolicyPattern = /^[A-Za-z0-9_:/.-]{10,120}$/;

// Approved by the owner: 20 EcoPoints/kg, at most 100 per verified delivery.
// Configuration alone must not enable points, receipts, verification or redemptions.
export const pointsPolicyRevision = "ecopulse:points/20-per-kg-cap-100-v1";
export const pointsPolicyMarker = "ECOPULSE_POINTS_POLICY_REVISION";
export const pointsPolicyLiveMarker = "ECOPULSE_POINTS_POLICY_LIVE_REVISION";
export const pointsPolicyValues = Object.freeze({ POINTS_PER_KG: "20", POINTS_MAX_PER_DELIVERY: "100" });

export async function configureApprovedPointsPolicy({ readEnvironment, setVariable }) {
  const environment = await readEnvironment();
  assert.ok(environment instanceof Map, "render_environment_invalid");
  const alreadyApplied = environment.get(pointsPolicyMarker) === pointsPolicyRevision;
  const changed = [];
  if (!alreadyApplied) {
    assert.notEqual(environment.get("EVALUATION_MODE_ENABLED"), "true", "unexpected_evaluation_service");
    assert.notEqual(environment.get("PILOT_POINTS_ENABLED"), "true", "points_must_be_disabled_during_policy_update");
    for (const [key, value] of Object.entries(pointsPolicyValues)) {
      if (environment.get(key) !== value) {
        await setVariable(key, value);
        changed.push(key);
      }
    }
    const updated = await readEnvironment();
    assert.ok(Object.entries(pointsPolicyValues).every(([key, value]) => updated.get(key) === value), "points_policy_not_confirmed");
    await setVariable(pointsPolicyMarker, pointsPolicyRevision);
  }
  const confirmed = await readEnvironment();
  assert.equal(confirmed.get(pointsPolicyMarker), pointsPolicyRevision, "points_policy_marker_not_confirmed");
  return { check: "approved_points_policy", status: "PASS", revision: pointsPolicyRevision, alreadyApplied, changed,
    deployRequired: confirmed.get(pointsPolicyLiveMarker) !== pointsPolicyRevision };
}

const reportedFlags = Object.freeze([
  ...draftFlags, ...rewardFlags, "PILOT_CATALOG_PUBLICATION_ENABLED", "PILOT_DELIVERY_DETAILS_ENABLED",
  "PILOT_RECEIPT_ENABLED", "PILOT_VERIFICATION_ENABLED", "PILOT_POINTS_ENABLED",
  "PILOT_REWARD_PUBLICATION_ENABLED", "PILOT_AI_ENABLED", "EVALUATION_MODE_ENABLED",
]);

export function safeActivationSnapshot(environment) {
  // Do not log arbitrary names, values, URLs or credentials from Render.
  return reportedFlags.map(key => ({ flag: key, state: !environment.has(key) ? "absent"
    : environment.get(key) === "true" ? "enabled" : environment.get(key) === "false" ? "disabled" : "invalid" }));
}

export async function activateDraftEditing({ readEnvironment, setVariable }) {
  const environment = await readEnvironment();
  assert.ok(environment instanceof Map, "render_environment_invalid");
  const alreadyApplied = environment.get(activationMarker) === activationRevision;
  const changed = [];
  if (!alreadyApplied) {
    // Do not change the main database mode or connect the rehearsal environment
    // to production. That requires separately verified isolation and approval.
    assert.notEqual(environment.get("EVALUATION_MODE_ENABLED"), "true", "unexpected_evaluation_service");
    for (const flag of draftFlags) {
      if (environment.get(flag) !== "true") {
        await setVariable(flag, "true");
        changed.push(flag);
      }
    }
    // Re-read from Render before marking the activation completed. Failed or
    // partial updates remain resumable and never produce a success report.
    const updated = await readEnvironment();
    assert.ok(draftFlags.every(flag => updated.get(flag) === "true"), "draft_activation_not_confirmed");
    await setVariable(activationMarker, activationRevision);
  }
  const confirmed = await readEnvironment();
  assert.equal(confirmed.get(activationMarker), activationRevision, "activation_marker_not_confirmed");
  return { check: "production_draft_activation", status: "PASS", revision: activationRevision,
    alreadyApplied, changed, deployRequired: confirmed.get(activationLiveMarker) !== activationRevision,
    flags: safeActivationSnapshot(confirmed) };
}

export async function activateRewardFulfillment({ readEnvironment, setVariable }) {
  const environment = await readEnvironment();
  assert.ok(environment instanceof Map, "render_environment_invalid");
  const alreadyApplied = environment.get(rewardActivationMarker) === rewardActivationRevision;
  const changed = [];
  if (!alreadyApplied) {
    assert.notEqual(environment.get("EVALUATION_MODE_ENABLED"), "true", "unexpected_evaluation_service");
    for (const flag of rewardFlags) {
      if (environment.get(flag) !== "true") {
        await setVariable(flag, "true");
        changed.push(flag);
      }
    }
    if (!rewardPolicyPattern.test(environment.get("REWARD_POLICY_REFERENCE") ?? "")) {
      await setVariable("REWARD_POLICY_REFERENCE", rewardPolicyReference);
      changed.push("REWARD_POLICY_REFERENCE");
    }
    const updated = await readEnvironment();
    assert.ok(rewardFlags.every(flag => updated.get(flag) === "true"), "reward_activation_not_confirmed");
    assert.match(updated.get("REWARD_POLICY_REFERENCE") ?? "", rewardPolicyPattern, "reward_policy_reference_not_confirmed");
    await setVariable(rewardActivationMarker, rewardActivationRevision);
  }
  const confirmed = await readEnvironment();
  assert.equal(confirmed.get(rewardActivationMarker), rewardActivationRevision, "reward_activation_marker_not_confirmed");
  assert.match(confirmed.get("REWARD_POLICY_REFERENCE") ?? "", rewardPolicyPattern, "reward_policy_reference_missing");
  return { check: "production_reward_activation", status: "PASS", revision: rewardActivationRevision,
    alreadyApplied, changed, policyConfigured: true,
    deployRequired: confirmed.get(rewardActivationLiveMarker) !== rewardActivationRevision,
    flags: safeActivationSnapshot(confirmed) };
}
