import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const api = "https://ecopulse-3xb4.onrender.com";
const frontend = "https://ecopulseef.netlify.app";
const expected = process.env.EXPECTED_PRODUCTION_SHA || process.env.GITHUB_SHA;
assert.match(expected || "", /^[a-f0-9]{40}$/i, "An exact deployed SHA is required");
assert.equal(process.env.GITHUB_ACTIONS, "true", "Run functional QA on the remote GitHub runner, not locally");
async function get(path, headers = {}) {
  return fetch(`${api}${path}`, { headers, signal: AbortSignal.timeout(45000), redirect: "error" });
}

// Deploys and cold starts can take several minutes. Never equate a healthy old
// instance with evidence that this commit was deployed.
let version;
let deploy;
const deadline = Date.now() + 8 * 60 * 1000;
for (let attempt = 0; attempt < 20 && Date.now() < deadline; attempt++) {
  try {
    const response = await get("/api/version");
    if (response.ok) {
      version = await response.json();
    }
    const site = await fetch("https://api.netlify.com/api/v1/sites/ecopulseef.netlify.app", {
      headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000), redirect: "error",
    });
    if (site.ok) deploy = (await site.json()).published_deploy;
    if (version?.commit === expected && deploy?.state === "ready" && deploy?.commit_ref === expected) break;
  } catch { /* retry within the bounded deployment window */ }
  await setTimeout(20000);
}
assert.equal(version?.commit, expected, "Render must expose the exact workflow SHA");
console.log(JSON.stringify({ check: "deployed_sha", status: "PASS", commit: version.commit }));
assert.equal(deploy?.state, "ready");
assert.equal(deploy?.commit_ref, expected, "Netlify must serve the same expected SHA");
console.log(JSON.stringify({ check: "netlify_sha", status: "PASS", commit: deploy.commit_ref, deploy: deploy.id }));
const health = await get("/api/healthz", { Origin: frontend });
assert.equal(health.status, 200);
assert.equal(health.headers.get("access-control-allow-origin"), frontend);
assert.equal(health.headers.get("access-control-allow-credentials"), "true");
assert.equal((await health.json()).status, "ok");
// Derive every private endpoint from the checked-out router. Test denial for
// each method without credentials; never send authenticated mutations.
const { readFile } = await import("node:fs/promises");
const source = await readFile(new URL("../../artifacts/api-server/src/routes/pilot.ts", import.meta.url), "utf8");
const routes = [...source.matchAll(/^router\.(get|post|patch|delete)\("([^"]+)"/gm)];
assert.ok(routes.length >= 44, "Private endpoint inventory unexpectedly shrank");
for (const [, method, route] of routes) {
  const path = `/api/pilot${route.replace(/:clerkUserId/g, "user_QaNotAnAccount").replace(/:kind/g, "points").replace(/:id/g, "00000000-0000-4000-8000-000000000000")}`;
  const response = await fetch(`${api}${path}`, { method: method.toUpperCase(), signal: AbortSignal.timeout(45000), redirect: "error" });
  assert.equal(response.status, 401, `anonymous access: ${method} ${path}`);
  assert.equal((await response.json()).error, "authentication_required");
  console.log(JSON.stringify({ check: `${method.toUpperCase()} ${route}`, status: "PASS", scope: "anonymous_denial_only", http: response.status }));
}
const missing = await get("/api/qa-nonexistent-route");
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error, "api_route_not_found");
const hostile = await get("/api/healthz", { Origin: "https://example.invalid" });
assert.notEqual(hostile.headers.get("access-control-allow-origin"), "https://example.invalid");
console.log(JSON.stringify({ check: "health_cors_json404", status: "PASS" }));
