import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_TIMEOUT_MS, reusableDeploy, waitForLive, verifyRuntime } from "./render-deploy-policy.mjs";
const sha = "a".repeat(40);
function clock() {
  let time = 0;
  return { now: () => time, sleep: async ms => { time += ms; } };
}
test("20 minute budget accepts Live after 9m02s without a second deployment", async () => {
  assert.equal(LIVE_TIMEOUT_MS, 1200000);
  const c = clock();
  await waitForLive({ ...c, sha, read: async () => ({ status: c.now() >= 542000 ? "live" : "build_in_progress", commit: { id: sha } }) });
  assert.ok(c.now() >= 542000 && c.now() < LIVE_TIMEOUT_MS);
});
test("reuse matching active or live deployment; never reuse another commit or failed deployment", () => {
  const deploy = { id: "dep-existing", status: "build_in_progress", commit: { id: sha } };
  assert.equal(reusableDeploy([{ deploy }], sha), deploy);
  assert.equal(reusableDeploy([{ deploy: { ...deploy, status: "live" } }], sha).id, deploy.id);
  assert.equal(reusableDeploy([{ deploy }], "b".repeat(40)), undefined);
  assert.equal(reusableDeploy([{ deploy: { ...deploy, status: "build_failed" } }], sha), undefined);
});
test("failed/cancelled deploys stop immediately, not at deadline", async () => {
  for (const status of ["build_failed", "pre_deploy_failed", "update_failed", "canceled", "cancelled"]) {
    const c = clock();
    await assert.rejects(waitForLive({ ...c, sha, read: async () => ({ status }) }), new RegExp(status));
    assert.equal(c.now(), 0);
  }
});
test("Live with another SHA fails and hanging deployment consumes only the 20 minute budget", async () => {
  const c = clock();
  await assert.rejects(waitForLive({ ...c, sha, read: async () => ({ status: "live", commit: { id: "wrong" } }) }), /commit_mismatch/);
  await assert.rejects(waitForLive({ ...c, sha, read: async () => ({ status: "queued" }) }), /timeout_20_minutes/);
  assert.equal(c.now(), LIVE_TIMEOUT_MS);
});
test("Live is insufficient: health/version must identify the expected running service", async () => {
  for (const mode of ["404", "wrong_sha", "bad_health"]) {
    const c = clock();
    await assert.rejects(verifyRuntime({ ...c, sha, timeoutMs: 20000, fetchImpl: async url => {
      if (url.includes("healthz")) return Response.json({ status: mode === "bad_health" ? "down" : "ok" });
      return mode === "404" ? new Response("not found", { status: 404 }) : Response.json({ service: "ecopulse-api", commit: mode === "wrong_sha" ? "wrong" : sha });
    } }), /runtime_not_verified/);
  }
  await verifyRuntime({ ...clock(), sha, fetchImpl: async url => Response.json(url.includes("healthz") ? { status: "ok" } : { service: "ecopulse-api", commit: sha }) });
});
