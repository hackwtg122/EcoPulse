import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { reusableDeploy, waitForLive, verifyRuntime } from "./render-deploy-policy.mjs";
import { activateDraftEditing, activationLiveMarker, activationRevision } from "./production-activation-policy.mjs";
import { execFileSync } from "node:child_process";
import { activateStructuredAI, aiLiveMarker, aiRevision } from "./production-ai-activation.mjs";

assert.equal(process.env.GITHUB_ACTIONS, "true", "remote_runner_required");
assert.equal(process.env.GITHUB_REPOSITORY, "hackwtg122/EcoPulse", "official_repository_required");
assert.equal(process.env.GITHUB_REF, "refs/heads/main", "main_branch_required");
assert.ok(["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME), "unauthorized_workflow_event");
const key = process.env.RENDER_API_KEY;
if (!key) throw new Error("Configure repository Actions secret RENDER_API_KEY; no deployment attempted");
const sha = process.env.GITHUB_SHA;
assert.match(sha || "", /^[a-f0-9]{40}$/i);
// Public Git transport avoids anonymous REST rate limits without broadening
// workflow permissions or sending the Render credential to GitHub.
let remoteHead;
try {
  remoteHead = execFileSync("git", ["ls-remote", "--exit-code", "https://github.com/hackwtg122/EcoPulse.git", "refs/heads/main"],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
} catch { throw new Error("main_head_verification_failed"); }
assert.match(remoteHead, /^[a-f0-9]{40}\s+refs\/heads\/main$/i, "main_head_response_invalid");
assert.equal(remoteHead.split(/\s+/)[0], sha, "stale_workflow_refusing_to_deploy_old_main_commit");
const api = "https://api.render.com/v1";
async function request(path, body, method = body ? "POST" : "GET", timeoutMs = 30000) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error", signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw Object.assign(new Error(`render_api_http_${response.status}`), { status: response.status });
  return response.json();
}
// Discover by the exact official URL; never guess a service ID or touch another
// project. Do not log service listings, response bodies, configuration or keys.
let cursor;
const matches = [];
for (let page = 0; page < 10; page++) {
  const rows = await request(`/services?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  assert.ok(Array.isArray(rows), "invalid_render_service_listing");
  for (const row of rows) {
    const service = row.service;
    if (service?.type === "web_service" && service.serviceDetails?.url?.replace(/\/$/, "") === "https://ecopulse-3xb4.onrender.com") matches.push(service);
  }
  if (rows.length < 100) break;
  const next = rows.at(-1)?.cursor;
  assert.ok(next && next !== cursor, "render_service_pagination_failed");
  cursor = next;
  if (page === 9) throw new Error("render_service_listing_limit_exceeded");
}
assert.equal(matches.length, 1, "exactly_one_official_render_service_required");
const service = matches[0];
assert.equal(service.repo?.replace(/\.git$/, ""), "https://github.com/hackwtg122/EcoPulse", "render_repository_mismatch");
assert.equal(service.branch, "main", "render_branch_mismatch");
let details = await request(`/services/${encodeURIComponent(service.id)}`);
function noPredeploy(value) {
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    if (name === "preDeployCommand") assert.ok(!child || !String(child).trim(), "predeploy_command_not_authorized");
    if (typeof child === "object") noPredeploy(child);
  }
}
noPredeploy(details);
assert.equal(details.serviceDetails?.runtime || details.serviceDetails?.env, "node", "only_existing_node_runtime_supported");
const buildCommand = "corepack pnpm install --frozen-lockfile && corepack pnpm --filter @workspace/api-server build";
const startCommand = "corepack pnpm --filter @workspace/api-server start";
if ((details.rootDir || "") !== "" || details.serviceDetails?.envSpecificDetails?.buildCommand?.trim() !== buildCommand ||
    details.serviceDetails?.envSpecificDetails?.startCommand?.trim() !== startCommand) {
  await request(`/services/${encodeURIComponent(service.id)}`, {
    rootDir: "", serviceDetails: { envSpecificDetails: { buildCommand, startCommand } },
  }, "PATCH");
  details = await request(`/services/${encodeURIComponent(service.id)}`);
  noPredeploy(details);
}
assert.equal(details.rootDir || "", "", "render_root_update_not_confirmed");
assert.equal(details.serviceDetails?.envSpecificDetails?.buildCommand?.trim(), buildCommand, "render_build_update_not_confirmed");
assert.equal(details.serviceDetails?.envSpecificDetails?.startCommand?.trim(), startCommand, "render_start_update_not_confirmed");
console.log(JSON.stringify({ check: "render_start_configuration", root: details.rootDir || "", buildCommand, startCommand }));
// The owner explicitly authorized ordinary flag configuration. Test the narrow
// policy in this same remote runner before using its existing Render credential.
execFileSync(process.execPath, ["--test", "scripts/qa/production-activation-policy.test.mjs", "scripts/qa/production-ai-activation.test.mjs"],
  { stdio: "inherit", env: { ...process.env, RENDER_API_KEY: "" } });
const envPath = `/services/${encodeURIComponent(service.id)}/env-vars`;
async function readEnvironment() {
  const environment = new Map();
  let cursor;
  for (let page = 0; page < 10; page++) {
    const rows = await request(`${envPath}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.ok(Array.isArray(rows), "render_environment_listing_invalid");
    for (const row of rows) {
      assert.equal(typeof row.envVar?.key, "string", "render_environment_key_invalid");
      assert.equal(typeof row.envVar?.value, "string", "render_environment_value_invalid");
      assert.ok(!environment.has(row.envVar.key), "render_environment_duplicate_key");
      environment.set(row.envVar.key, row.envVar.value);
    }
    if (rows.length < 100) return environment;
    const next = rows.at(-1)?.cursor;
    assert.ok(next && next !== cursor, "render_environment_pagination_failed");
    cursor = next;
  }
  throw new Error("render_environment_listing_limit_exceeded");
}
const activation = await activateDraftEditing({ readEnvironment,
  setVariable: (key, value) => request(`${envPath}/${encodeURIComponent(key)}`, { value }, "PUT") });
console.log(JSON.stringify(activation));
const aiActivation = await activateStructuredAI({ readEnvironment,
  setVariable: (key, value) => request(`${envPath}/${encodeURIComponent(key)}`, { value }, "PUT"),
  readCatalog: async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", { redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, "public_model_catalog_unavailable");
    return response.json();
  } });
console.log(JSON.stringify(aiActivation));
// Deploy code and the two approved draft flags. No migrations, role grants,
// points/reward policy activation, billing or auto-deploy setting changes.
const deployPath = `/services/${encodeURIComponent(service.id)}/deploys`;
// An auto-deploy started before the environment update must not be mistaken for
// proof that the new flags are live, even when it has the same code SHA.
const existing = activation.deployRequired || aiActivation.deployRequired ? null : reusableDeploy(await request(`${deployPath}?limit=100`), sha);
const deploy = existing || await request(deployPath, { commitId: sha, clearCache: "do_not_clear" });
assert.ok(deploy.id, "missing_render_deploy_id");
console.log(JSON.stringify({ check: existing ? "render_deploy_reused" : "render_deploy_requested", deploy: deploy.id, expectedCommit: sha }));
await waitForLive({
  read: timeout => request(`${deployPath}/${encodeURIComponent(deploy.id)}`, undefined, "GET", timeout),
  sha, sleep: setTimeout,
  onStatus: status => console.log(JSON.stringify({ check: "render_deploy_state", status })),
});
await verifyRuntime({ sha, sleep: setTimeout });
if (activation.deployRequired) {
  await request(`${envPath}/${encodeURIComponent(activationLiveMarker)}`, { value: activationRevision }, "PUT");
  assert.equal((await readEnvironment()).get(activationLiveMarker), activationRevision, "activation_live_marker_not_confirmed");
}
if (aiActivation.deployRequired) {
  await request(`${envPath}/${encodeURIComponent(aiLiveMarker)}`, { value: aiRevision }, "PUT");
  assert.equal((await readEnvironment()).get(aiLiveMarker), aiRevision, "ai_activation_live_marker_not_confirmed");
}
console.log(JSON.stringify({ check: "render_live_and_runtime_verified", status: "PASS", commit: sha, deploy: deploy.id }));
