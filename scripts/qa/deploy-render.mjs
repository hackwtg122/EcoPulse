import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { reusableDeploy, waitForLive, verifyRuntime } from "./render-deploy-policy.mjs";

assert.equal(process.env.GITHUB_ACTIONS, "true", "remote_runner_required");
assert.equal(process.env.GITHUB_REPOSITORY, "hackwtg122/EcoPulse", "official_repository_required");
assert.equal(process.env.GITHUB_REF, "refs/heads/main", "main_branch_required");
assert.ok(["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME), "unauthorized_workflow_event");
const key = process.env.RENDER_API_KEY;
if (!key) throw new Error("Configure repository Actions secret RENDER_API_KEY; no deployment attempted");
const sha = process.env.GITHUB_SHA;
assert.match(sha || "", /^[a-f0-9]{40}$/i);
const head = await fetch("https://api.github.com/repos/hackwtg122/EcoPulse/git/ref/heads/main", {
  headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30000), redirect: "error",
});
assert.equal(head.status, 200, "main_head_verification_failed");
assert.equal((await head.json()).object?.sha, sha, "stale_workflow_refusing_to_deploy_old_main_commit");
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
// Trigger only a code deploy for the approved SHA. No migrations, environment
// changes, role grants, billing actions or auto-deploy setting changes.
const deployPath = `/services/${encodeURIComponent(service.id)}/deploys`;
const existing = reusableDeploy(await request(`${deployPath}?limit=100`), sha);
const deploy = existing || await request(deployPath, { commitId: sha, clearCache: "do_not_clear" });
assert.ok(deploy.id, "missing_render_deploy_id");
console.log(JSON.stringify({ check: existing ? "render_deploy_reused" : "render_deploy_requested", deploy: deploy.id, expectedCommit: sha }));
await waitForLive({
  read: timeout => request(`${deployPath}/${encodeURIComponent(deploy.id)}`, undefined, "GET", timeout),
  sha, sleep: setTimeout,
  onStatus: status => console.log(JSON.stringify({ check: "render_deploy_state", status })),
});
await verifyRuntime({ sha, sleep: setTimeout });
console.log(JSON.stringify({ check: "render_live_and_runtime_verified", status: "PASS", commit: sha, deploy: deploy.id }));
