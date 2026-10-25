import assert from "node:assert/strict";
import test from "node:test";
import { shouldWarmPilotApi, warmPilotApi } from "./pilot-warmup.ts";

test("warms only authentication and protected routes", () => {
  for (const path of ["/", "/materials", "/materials/paper", "/faq", "/contact"]) {
    assert.equal(shouldWarmPilotApi(path), false, path);
  }
  for (const path of ["/sign-in", "/sign-up/verify", "/dashboard", "/map", "/admin/centers"]) {
    assert.equal(shouldWarmPilotApi(path), true, path);
  }
  assert.equal(shouldWarmPilotApi("/eco/dashboard", "/eco/"), true);
  assert.equal(shouldWarmPilotApi("/ecology/dashboard", "/eco/"), false);
});

test("warmup only reads public health without cookies or authorization", async () => {
  const requests = [];
  const fetchStub = async (...args) => { requests.push(args); return { ok: true }; };
  warmPilotApi("/materials", "/", "https://example.org", fetchStub);
  warmPilotApi("/dashboard", "/", "https://example.org/", fetchStub);
  await Promise.resolve();
  assert.deepEqual(requests, [["https://example.org/api/healthz", {
    cache: "no-store", credentials: "omit", mode: "cors",
  }]]);
});

test("failed health warmup never blocks the dashboard", async () => {
  warmPilotApi("/dashboard", "/", "https://example.org", async () => { throw new Error("offline"); });
  await new Promise(resolve => setImmediate(resolve));
});
