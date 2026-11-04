import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError, VERIFIED_FREE_OPEN_MODELS, parseVisionPayload, parseChatPayload, classifyImageWithVision, chatWithStructured, providerSelfTest } from "./aiProvider.ts";

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

test("OpenRouter requires schema-capable free routing and excludes private reasoning", async () => {
  const capture = {};
  await classifyImageWithVision(baseCfg, "aW1n", okFetch(JSON.stringify(goodPayload), capture));
  assert.deepEqual(capture.body.provider, { require_parameters: true, max_price: { prompt: 0, completion: 0 } });
  assert.deepEqual(capture.body.reasoning, { effort: "low", exclude: true });
});

test("truncated output is rejected without retrying or exposing provider content", async () => {
  let calls = 0;
  await assert.rejects(classifyImageWithVision({ ...baseCfg, maxRetries: 2 }, "aW1n", async () => {
    calls++;
    return { ok: true, status: 200, async json() { return { choices: [{ finish_reason: "length", message: { content: 'private-provider-sentinel' } }] }; } };
  }), error => {
    assert.equal(error.code, "invalid_ai_response");
    assert.equal(error.diagnostic, "output_truncated");
    assert.ok(!JSON.stringify(error).includes("private-provider-sentinel"));
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(new AiProviderError(502, "invalid_ai_response", undefined, "private-provider-sentinel").diagnostic, undefined);
});

test("safe vision diagnostics distinguish JSON, shape and explanation without weakening validation", async () => {
  await assert.rejects(classifyImageWithVision(baseCfg, "aW1n", okFetch("private-provider-sentinel")), { diagnostic: "json_syntax_invalid" });
  assert.throws(() => parseVisionPayload({ ...goodPayload, extra: "private-provider-sentinel" }), { diagnostic: "vision_shape_invalid" });
  assert.throws(() => parseVisionPayload({ ...goodPayload, explanation: "x".repeat(401) }), { diagnostic: "vision_explanation_invalid" });
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
  // A transient server failure may retry; rate limits must reach the client.
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, async json() { return {}; } };
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
    baseCfg, "s".repeat(9000), longHistory, "q".repeat(900), "c".repeat(2000),
    okFetch(JSON.stringify({ answer: "  Recicla   vidrio. " }), capture),
  );
  assert.deepEqual(answer, { answer: "Recicla vidrio." });
  assert.equal(capture.body.messages[0].content.length, 6000);
  assert.equal(capture.body.messages.length, 2 /* systems */ + 6 /* history */ + 1);
  assert.equal(capture.body.messages.at(-1).content.length, 500);
  assert.equal(capture.body.response_format.json_schema.schema.properties.answer.maxLength, 800);
  await rejectsWith(chatWithStructured(baseCfg, "sys", [], "hola", undefined, okFetch(JSON.stringify({ answer: "a".repeat(900) }))), 502, "invalid_ai_response");
  await rejectsWith(chatWithStructured(baseCfg, "sys", [], "hola", undefined, okFetch(JSON.stringify({}))), 502, "invalid_ai_response");
});

test("rate limits keep the advertised wait and audit failures never mask a valid analysis", async () => {
  let calls = 0;
  const always429 = async () => {
    calls++;
    return {
    ok: false, status: 429,
    headers: { get: (name) => name === "retry-after" ? "42" : null },
    async json() { return {}; },
    };
  };
  await classifyImageWithVision({ ...baseCfg, maxRetries: 2 }, "aW1n", always429).then(
    () => assert.fail("expected rejection ai_rate_limited"),
    (error) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "ai_rate_limited");
      assert.equal(error.retryAfterSeconds, 42);
    },
  );
  assert.equal(calls, 1, "429 must not consume automatic retries");
  // A store hiccup while closing the audit row must not discard a real answer.
  const result = await classifyImageWithVision({
    ...baseCfg,
    beforeAttempt: () => "id-1",
    afterAttempt: () => { throw new Error("quota store down"); },
  }, "aW1n", okFetch(JSON.stringify(goodPayload)));
  assert.equal(result.category, "plastic");
});

test("chat output rejects null, arrays, extra fields and non-string answers safely", () => {
  for (const value of [null, [], {}, { answer: null }, { answer: "", points: 1 }]) {
    assert.throws(() => parseChatPayload(value), error => error instanceof AiProviderError && error.code === "invalid_ai_response");
  }
});

test("providerSelfTest is a boolean probe that never throws", async () => {
  assert.equal(await providerSelfTest(baseCfg, okFetch(JSON.stringify({ ok: true }))), true);
  assert.equal(await providerSelfTest(baseCfg, okFetch(JSON.stringify({ ok: false }))), false);
  assert.equal(await providerSelfTest(baseCfg, async () => ({ ok: false, status: 503, async json() { return {}; } })), false);
  assert.equal(await providerSelfTest(baseCfg, async () => { throw new Error("offline"); }), false);
  assert.equal(await providerSelfTest({ ...baseCfg, apiKey: "" }, okFetch(JSON.stringify({ ok: true }))), false);
});

test("NVIDIA NIM routes only to official host with model-specific JSON instructions and validates chat/vision", async () => {
  const cfg = { ...baseCfg, provider: "nvidia", apiKey: "unit-nvidia-key", baseUrl: "https://untrusted.invalid/v1", chatModel: "nvidia/nemotron-3-super-120b-a12b", visionModel: "nvidia/nemotron-3.5-super-vl-120b-a12b" };
  const chat = {};
  const result = await chatWithStructured(cfg, "EcoGuía", [], "¿Dónde va el vidrio?", undefined, okFetch('{"answer":"Separa el vidrio limpio."}', chat));
  assert.equal(result.answer, "Separa el vidrio limpio.");
  assert.equal(chat.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(chat.body.model, cfg.chatModel);
  assert.equal(chat.body.response_format, undefined);
  assert.equal(chat.body.store, undefined);
  assert.equal(chat.body.top_p, 0.95);
  assert.match(chat.body.messages[0].content, /objeto JSON válido/);
  assert.equal(chat.options.headers.Authorization, `Bearer ${cfg.apiKey}`);
  const vision = {};
  const classified = await classifyImageWithVision(cfg, "aW1n", okFetch(JSON.stringify(goodPayload), vision));
  assert.equal(classified.category, "plastic");
  assert.equal(vision.body.model, cfg.visionModel);
  assert.equal(vision.body.temperature, 0.6);
  assert.equal(vision.body.messages.at(-1).content.at(-1).image_url.url, "data:image/png;base64,aW1n");
  await rejectsWith(classifyImageWithVision({ ...cfg, visionModel: cfg.chatModel }, "aW1n", async () => assert.fail("invalid model must send nothing")), 503, "ai_provider_model_not_allowed");
  await rejectsWith(chatWithStructured(cfg, "EcoGuía", [], "Hola", undefined, okFetch("no es JSON")), 502, "invalid_ai_response");
});

test("NVIDIA rate limits return Retry-After without retrying, and transport timeouts stay bounded", async () => {
  const cfg = { ...baseCfg, provider: "nvidia", chatModel: "nvidia/nemotron-3-super-120b-a12b", maxRetries: 2 };
  let calls = 0;
  await assert.rejects(chatWithStructured(cfg, "EcoGuía", [], "Hola", undefined, async () => {
    calls++;
    return { ok: false, status: 429, headers: { get: () => "27" } };
  }), error => error.code === "ai_rate_limited" && error.retryAfterSeconds === 27);
  assert.equal(calls, 1);
  await rejectsWith(chatWithStructured({ ...cfg, maxRetries: 0 }, "EcoGuía", [], "Hola", undefined,
    async () => ({ ok: false, status: 401 })), 503, "ai_provider_auth_failed");
  await rejectsWith(chatWithStructured({ ...cfg, maxRetries: 0 }, "EcoGuía", [], "Hola", undefined,
    async () => ({ ok: false, status: 400 })), 502, "ai_provider_rejected_request");
  await rejectsWith(chatWithStructured({ ...cfg, maxRetries: 0, timeoutMs: 5 }, "EcoGuía", [], "Hola", undefined,
    async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }))), 502, "ai_provider_unavailable");
});
