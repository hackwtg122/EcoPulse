import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError, VERIFIED_FREE_OPEN_MODELS, parseVisionPayload, classifyImageWithVision, chatWithStructured, providerSelfTest } from "./aiProvider.ts";

const secretKey = "test-secret-key-do-not-leak";
const baseCfg = {
  provider: "openrouter",
  apiKey: secretKey,
  visionModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  chatModel: "nvidia/nemotron-3-super-120b-a12b:free",
  timeoutMs: 5_000,
  maxRetries: 0,
  retryBackoffMs: 1,
  visionMaxTokens: 1_000,
  chatMaxTokens: 2_000,
};

const goodPayload = { category: "plastic", explanation: "Se ve una botella transparente.", ambiguous: false, confidence: "high" };

function okFetch(content, capture = {}) {
  return async (url, options) => {
    capture.url = url;
    capture.options = options;
    capture.body = JSON.parse(options.body);
    return { ok: true, status: 200, async json() { return { choices: [{ message: { content } }] }; } };
  };
}

function rejectsWith(fn, status, code) {
  return fn.then(
    () => assert.fail(`expected rejection ${code}`),
    (error) => {
      assert.ok(error instanceof AiProviderError, `expected AiProviderError, got ${error}`);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.ok(!String(error.message).includes(secretKey), "error must not leak the api key");
    },
  );
}

test("verified free open models are exported and exist as catalog ids", () => {
  assert.ok(VERIFIED_FREE_OPEN_MODELS.length >= 1);
  for (const id of VERIFIED_FREE_OPEN_MODELS) assert.match(id, /^[a-z0-9._-]+\/[a-z0-9._:-]+:free$/i);
});

test("model gate never admits unconfigured, paid or unverified models", async () => {
  // No server-side key: the provider must not be called at all.
  await rejectsWith(classifyImageWithVision({ ...baseCfg, apiKey: "" }, "aW1n", okFetch("{}")), 503, "ai_provider_unconfigured");
  await rejectsWith(chatWithStructured({ ...baseCfg, apiKey: "" }, "sys", [], "hola"), 503, "ai_provider_unconfigured");
  // Paid model: rejected even without an allowlist.
  await rejectsWith(classifyImageWithVision({ ...baseCfg, visionModel: "openai/gpt-4o" }, "aW1n", okFetch("{}")), 503, "ai_provider_model_not_allowed");
  // A supplied allowlist is not proof of pricing or license: it cannot admit models
  // outside the built-in verified set.
  await rejectsWith(classifyImageWithVision({ ...baseCfg, visionModel: "openai/gpt-4o", visionAllowlist: ["openai/gpt-4o"] }, "aW1n", okFetch("{}")), 503, "ai_provider_model_not_verified");
  // Any other :free model outside the verified set: rejected.
  await rejectsWith(classifyImageWithVision({ ...baseCfg, visionModel: "some-org/unreviewed:free" }, "aW1n", okFetch("{}")), 503, "ai_provider_model_not_verified");
  // "openrouter/free" only resolves through a verified allowlist entry.
  await rejectsWith(classifyImageWithVision({ ...baseCfg, visionModel: "openrouter/free" }, "aW1n", okFetch("{}")), 503, "ai_provider_no_verified_free_open_model");
  const capture = {};
  const resolved = await classifyImageWithVision(
    { ...baseCfg, visionModel: "openrouter/free", visionAllowlist: [...VERIFIED_FREE_OPEN_MODELS] },
    "aW1n", okFetch(JSON.stringify(goodPayload), capture),
  );
  assert.equal(resolved.points, 0);
  assert.ok(VERIFIED_FREE_OPEN_MODELS.includes(capture.body.model), "openrouter/free must resolve to a verified model");
});

test("classification is a strict suggestion and can never add points or claims", async () => {
  const capture = {};
  const result = await classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify(goodPayload), capture));
  assert.deepEqual(result, { ...goodPayload, source: "ai_suggestion", persisted: false, points: 0 });
  // Request shape: OpenRouter chat completions, no retention, strict schema, sanitized PNG data URL.
  assert.match(capture.url, /\/chat\/completions$/);
  assert.equal(capture.body.store, false);
  assert.equal(capture.body.response_format.json_schema.strict, true);
  assert.equal(capture.options.headers.Authorization, `Bearer ${secretKey}`);
  assert.equal(capture.options.headers["X-Title"], "EcoPulse");
  assert.match(capture.body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
});

test("provider output is re-validated field by field", async () => {
  // Category outside the catalog.
  await rejectsWith(classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify({ ...goodPayload, category: "recyclable" }))), 502, "invalid_ai_category");
  // Extra fields (points, persistence claims) always fail.
  await rejectsWith(classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify({ ...goodPayload, points: 500 }))), 502, "invalid_ai_response");
  // Unknown or ambiguous results never keep a grounded confidence.
  const unknown = await classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify({ category: "unknown", explanation: "No se distingue el material.", ambiguous: false, confidence: "high" })));
  assert.deepEqual({ ambiguous: unknown.ambiguous, confidence: unknown.confidence }, { ambiguous: true, confidence: null });
  const ambiguous = await classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify({ category: "glass", explanation: "Brillos difusos.", ambiguous: true, confidence: "medium" })));
  assert.deepEqual({ ambiguous: ambiguous.ambiguous, confidence: ambiguous.confidence }, { ambiguous: true, confidence: null });
  // Empty explanation and malformed JSON are rejected.
  await rejectsWith(classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify({ ...goodPayload, explanation: "  " }))), 502, "invalid_ai_response");
  await rejectsWith(classifyImageWithVision(baseCfg, "aW1n", okFetch("not-json")), 502, "invalid_ai_response");
});

test("parseVisionPayload normalizes whitespace and enforces exact shape", () => {
  assert.deepEqual(parseVisionPayload({ ...goodPayload, explanation: "  Se   ve plástico. " }), { ...goodPayload, explanation: "Se ve plástico." });
  assert.throws(() => parseVisionPayload(null), (error) => error instanceof AiProviderError && error.code === "invalid_ai_response");
  assert.throws(() => parseVisionPayload([goodPayload]), (error) => error instanceof AiProviderError && error.code === "invalid_ai_response");
  assert.throws(() => parseVisionPayload({ ...goodPayload, ambiguous: "no" }), (error) => error instanceof AiProviderError && error.code === "invalid_ai_response");
  assert.throws(() => parseVisionPayload({ ...goodPayload, confidence: "certain" }), (error) => error instanceof AiProviderError && error.code === "invalid_ai_response");
});

test("transient provider failures retry, then map to safe errors without leaking the key", async () => {
  // One 429 followed by success is retried transparently.
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify(goodPayload) } }] }; } };
  };
  const result = await classifyImageWithVision({ ...baseCfg, maxRetries: 1 }, "aW1n", flaky);
  assert.equal(calls, 2);
  assert.equal(result.category, "plastic");
  // Exhausted rate limit and provider crash map to stable codes and never expose the key.
  const always429 = async () => ({ ok: false, status: 429, async json() { return {}; } });
  await rejectsWith(classifyImageWithVision(baseCfg, "aW1n", always429), 429, "ai_rate_limited");
  const crash = async () => { throw new Error(`upstream boom with ${secretKey}`); };
  await rejectsWith(classifyImageWithVision(baseCfg, "aW1n", crash), 502, "ai_provider_unavailable");
});

test("every external retry has a successful reservation before fetch; denied reservation sends nothing", async () => {
  const order = [];
  const statuses = [];
  let calls = 0;
  const flaky = async () => {
    order.push("fetch"); calls += 1;
    return calls === 1 ? { ok: false, status: 503 } :
      { ok: true, status: 200, async json() { return { choices: [{ message: { content: JSON.stringify(goodPayload) } }] }; } };
  };
  await classifyImageWithVision({ ...baseCfg, maxRetries: 1,
    beforeAttempt: (_model, attempt) => { order.push(`reserve:${attempt}`); return `id-${attempt}`; },
    afterAttempt: (id, status) => { statuses.push([id, status]); },
  }, "aW1n", flaky);
  assert.deepEqual(order, ["reserve:1", "fetch", "reserve:2", "fetch"]);
  assert.deepEqual(statuses, [["id-1", "503"], ["id-2", "200"]]);
  order.length = 0;
  await rejectsWith(classifyImageWithVision({ ...baseCfg,
    beforeAttempt: () => { throw new AiProviderError(429, "ai_rate_limited"); },
  }, "aW1n", flaky), 429, "ai_rate_limited");
  assert.deepEqual(order, []);
});

test("chatWithStructured truncates inputs and validates answers", async () => {
  const capture = {};
  const longHistory = Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "x".repeat(500) }));
  const answer = await chatWithStructured(
    baseCfg, "s".repeat(3000), longHistory, "q".repeat(900), "c".repeat(2000),
    okFetch(JSON.stringify({ answer: "  Recicla   vidrio. " }), capture),
  );
  assert.deepEqual(answer, { answer: "Recicla vidrio." });
  assert.equal(capture.body.messages[0].content.length, 2000);
  assert.equal(capture.body.messages.length, 2 /* systems */ + 6 /* history */ + 1);
  assert.equal(capture.body.messages.at(-1).content.length, 500);
  await rejectsWith(chatWithStructured(baseCfg, "sys", [], "hola", undefined, okFetch(JSON.stringify({ answer: "a".repeat(900) }))), 502, "invalid_ai_response");
  await rejectsWith(chatWithStructured(baseCfg, "sys", [], "hola", undefined, okFetch(JSON.stringify({}))), 502, "invalid_ai_response");
});

test("rate limits keep the advertised wait and audit failures never mask a valid analysis", async () => {
  const always429 = async () => ({
    ok: false, status: 429,
    headers: { get: (name) => name === "retry-after" ? "42" : null },
    async json() { return {}; },
  });
  await classifyImageWithVision(baseCfg, "aW1n", always429).then(
    () => assert.fail("expected rejection ai_rate_limited"),
    (error) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "ai_rate_limited");
      assert.equal(error.retryAfterSeconds, 42);
    },
  );
  // A store hiccup while closing the audit row must not discard a real answer.
  const result = await classifyImageWithVision({
    ...baseCfg,
    beforeAttempt: () => "id-1",
    afterAttempt: () => { throw new Error("quota store down"); },
  }, "aW1n", okFetch(JSON.stringify(goodPayload)));
  assert.equal(result.category, "plastic");
});

test("providerSelfTest is a boolean probe that never throws", async () => {
  assert.equal(await providerSelfTest(baseCfg, okFetch(JSON.stringify({ ok: true }))), true);
  assert.equal(await providerSelfTest(baseCfg, okFetch(JSON.stringify({ ok: false }))), false);
  assert.equal(await providerSelfTest(baseCfg, async () => ({ ok: false, status: 503, async json() { return {}; } })), false);
  assert.equal(await providerSelfTest(baseCfg, async () => { throw new Error("offline"); }), false);
  assert.equal(await providerSelfTest({ ...baseCfg, apiKey: "" }, okFetch(JSON.stringify({ ok: true }))), false);
});
