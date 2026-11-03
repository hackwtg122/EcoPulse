import assert from "node:assert/strict";

// Owner-authorized, one-time activation of draft editing only. This list cannot
// publish catalog entries, award value, record receipts or change identities.
export const activationRevision = "congress-draft-editing-v1";
export const activationMarker = "ECOPULSE_ACTIVATION_REVISION";
export const activationLiveMarker = "ECOPULSE_ACTIVATION_LIVE_REVISION";
export const draftFlags = Object.freeze(["PILOT_CATALOG_ADMIN_ENABLED", "PILOT_REWARD_ADMIN_ENABLED"]);
const reportedFlags = Object.freeze([
  ...draftFlags, "PILOT_CATALOG_PUBLICATION_ENABLED", "PILOT_DELIVERY_DETAILS_ENABLED",
  "PILOT_RECEIPT_ENABLED", "PILOT_VERIFICATION_ENABLED", "PILOT_POINTS_ENABLED",
  "PILOT_REWARDS_ENABLED", "PILOT_REWARD_FULFILLMENT_ENABLED", "PILOT_REWARD_PUBLICATION_ENABLED",
  "PILOT_AI_ENABLED", "EVALUATION_MODE_ENABLED",
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
