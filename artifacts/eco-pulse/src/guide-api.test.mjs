import assert from "node:assert/strict";
import { test } from "node:test";
import { askGuide, createGuideRequestGate, loadGuideCapabilities } from "./guide-api.ts";

const signal = new AbortController().signal;
test("reads capabilities with authenticated no-store request", async () => {
  const enabled = await loadGuideCapabilities("https://api.invalid", "session-token", signal, async (url, init) => {
    assert.match(url, /guide\/capabilities$/); assert.equal(init.headers.Authorization, "Bearer session-token");
    assert.equal(init.cache, "no-store"); return Response.json({ enabled: true });
  });
  assert.equal(enabled, true);
});

test("auth, quota and duplicate-submit protection keep failures visible", async () => {
  const gate = createGuideRequestGate();
  assert.equal(gate.enter(), true);
  assert.equal(gate.enter(), false);
  gate.leave();
  assert.equal(gate.enter(), true);
  gate.leave();
  await assert.rejects(askGuide("https://api.invalid", "token", "Hola", [], signal,
    async () => Response.json({ error: "authentication_required" }, { status: 401 })), { status: 401, code: "authentication_required" });
  await assert.rejects(askGuide("https://api.invalid", "token", "Hola", [], signal,
    async () => Response.json({ error: "ai_quota_daily", retryAfterSeconds: 120 }, { status: 429 })),
    { status: 429, code: "ai_quota_daily", retryAfterSeconds: 120 });
});

test("bounded guide conversation sends no account fields and accepts AI only", async () => {
  const response = await askGuide("https://api.invalid", "session-token", " ¿Dónde va el papel? ",
    Array.from({ length: 9 }, () => ({ role: "user", content: "x".repeat(500) })), signal,
    async (_url, init) => {
      assert.equal(init.headers["X-AI-Consent"], "true");
      const request = JSON.parse(init.body);
      assert.deepEqual(Object.keys(request).sort(), ["history", "question"]);
      assert.equal(request.question, "¿Dónde va el papel?");
      assert.equal(request.history.length, 6); assert.equal(request.history[0].content.length, 300);
      return Response.json({ answer: "Papel limpio, separado.", source: "ai" });
    });
  assert.equal(response, "Papel limpio, separado.");
  await assert.rejects(askGuide("https://api.invalid", "token", "Hola", [], signal,
    async () => Response.json({ answer: "Falso", source: "rules" })), { code: "invalid_guide_response" });
});
