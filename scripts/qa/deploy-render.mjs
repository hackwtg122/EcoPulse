import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

assert.equal(process.env.GITHUB_ACTIONS, "true", "remote_runner_required");
const key = process.env.RENDER_API_KEY;
if (!key) throw new Error("Configure repository Actions secret RENDER_API_KEY; no deployment attempted");
const sha = process.env.GITHUB_SHA;
assert.match(sha || "", /^[a-f0-9]{40}$/i);
const api = "https://api.render.com/v1";
async function request(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`render_api_http_${response.status}`);
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
// Trigger only a code deploy for the approved SHA. No migrations, environment
// changes, role grants, billing actions or auto-deploy setting changes.
const deploy = await request(`/services/${encodeURIComponent(service.id)}/deploys`, { commitId: sha, clearCache: "do_not_clear" });
assert.ok(deploy.id, "missing_render_deploy_id");
console.log(JSON.stringify({ check: "render_deploy_requested", deploy: deploy.id, expectedCommit: sha }));
for (let attempt = 0; attempt < 35; attempt++) {
  const state = await request(`/services/${encodeURIComponent(service.id)}/deploys/${encodeURIComponent(deploy.id)}`);
  if (state.status === "live") {
    assert.equal(state.commit?.id, sha, "render_live_commit_mismatch");
    console.log(JSON.stringify({ check: "render_live", status: "PASS", commit: state.commit.id, deploy: deploy.id }));
    process.exit(0);
  }
  if (["build_failed", "update_failed", "canceled", "deactivated"].includes(state.status)) throw new Error(`render_deploy_${state.status}; inspect sanitized Render logs`);
  await setTimeout(15000);
}
throw new Error("render_deploy_live_timeout");
