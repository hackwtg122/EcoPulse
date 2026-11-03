import assert from "node:assert/strict";
import test from "node:test";
import { activateDraftEditing, activationMarker, activationLiveMarker, activationRevision, draftFlags, safeActivationSnapshot } from "./production-activation-policy.mjs";

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
