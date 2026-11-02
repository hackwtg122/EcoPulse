import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const api = "https://ecopulse-3xb4.onrender.com";
const frontend = "https://ecopulseef.netlify.app";
const expected = process.env.GITHUB_SHA;
async function get(path, headers = {}) {
  return fetch(`${api}${path}`, { headers, signal: AbortSignal.timeout(45000), redirect: "error" });
}

// Deploys and cold starts can take several minutes. Never equate a healthy old
// instance with evidence that this commit was deployed.
let version;
for (let attempt = 0; attempt < 16; attempt++) {
  try {
    const response = await get("/api/version");
    if (response.ok) {
      version = await response.json();
      if (version.commit === expected) break;
    }
  } catch { /* retry within the bounded deployment window */ }
  await setTimeout(20000);
}
assert.equal(version?.commit, expected, "Render must expose the exact workflow SHA");
console.log(JSON.stringify({ check: "deployed_sha", status: "PASS", commit: version.commit }));
const health = await get("/api/healthz", { Origin: frontend });
assert.equal(health.status, 200);
assert.equal(health.headers.get("access-control-allow-origin"), frontend);
assert.equal(health.headers.get("access-control-allow-credentials"), "true");
assert.equal((await health.json()).status, "ok");
for (const path of ["/api/pilot/me", "/api/pilot/admin/users", "/api/pilot/balance", "/api/pilot/verifier/deliveries"]) {
  const response = await get(path);
  assert.equal(response.status, 401, `anonymous access: ${path}`);
  assert.equal((await response.json()).error, "authentication_required");
  console.log(JSON.stringify({ check: path, status: "PASS", http: response.status }));
}
const missing = await get("/api/qa-nonexistent-route");
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error, "api_route_not_found");
const hostile = await get("/api/healthz", { Origin: "https://example.invalid" });
assert.notEqual(hostile.headers.get("access-control-allow-origin"), "https://example.invalid");
console.log(JSON.stringify({ check: "health_cors_json404", status: "PASS" }));
