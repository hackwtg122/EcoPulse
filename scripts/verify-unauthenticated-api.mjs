import assert from "node:assert/strict";

const apiOrigin = process.env.PILOT_API_ORIGIN || "http://127.0.0.1:5001";
const requests = [
  ["GET", "/api/pilot/me"],
  ["GET", "/api/pilot/balance"],
  ["GET", "/api/pilot/scans"],
  ["GET", "/api/pilot/deliveries"],
  ["GET", "/api/pilot/verifier/deliveries?limit=20"],
  ["GET", "/api/pilot/redemptions"],
  ["POST", "/api/pilot/scans", { category: "paper", userId: "client-controlled" }],
  ["POST", "/api/pilot/deliveries", { userId: "client-controlled" }],
  ["POST", "/api/pilot/deliveries/00000000-0000-4000-8000-000000000000/verify", { decision: "rejected" }],
  ["POST", "/api/pilot/redemptions", { rewardId: "00000000-0000-4000-8000-000000000000" }],
];

for (const [method, path, body] of requests) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    headers: body ? { "content-type": "application/json", "idempotency-key": "security_test" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 401, `${method} ${path} must reject an unauthenticated request`);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
}

console.log(JSON.stringify({
  unauthenticatedRequestsRejected: requests.length,
  readsRejected: requests.filter(([method]) => method === "GET").length,
  mutationsRejected: requests.filter(([method]) => method === "POST").length,
  privateResponsesNotCached: true,
  credentialsPrinted: false,
}, null, 2));
