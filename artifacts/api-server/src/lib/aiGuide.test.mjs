import assert from "node:assert/strict";
import test from "node:test";
import { AiGuideError, parseGuideRequest, askGuideWithOpenAI, askGuideWithProvider, consumeGuideQuota } from "./aiGuide.ts";
import { guideAccountDetails, guideSystemPrompt } from "./aiGuideCore.ts";

test("parseGuideRequest validates bounds and fields", () => {
  const req = parseGuideRequest({ question: "¿Cómo separo vidrio?", history: [{ role: "user", content: "Hola" }, { role: "assistant", content: "Explica" }], materialContext: "Guía breve de vidrio." });
  assert.equal(req.question, "¿Cómo separo vidrio?");
  assert.equal(req.history.length, 2);
  assert.throws(() => parseGuideRequest({ question: "" }), error => error instanceof AiGuideError);
  assert.throws(() => parseGuideRequest({ question: "x", extra: 1 }), error => error instanceof AiGuideError);
  assert.throws(() => parseGuideRequest({ question: "x", history: [{ role: "bot", content: "x" }] }), error => error instanceof AiGuideError);
});

test("askGuideWithOpenAI returns structured answer and respects safety", async () => {
  let captured;
  const fakeFetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return { ok: true, async json() { return { choices: [{ message: { content: '{"answer":"Separa vidrio limpio y seco, sin tapas metálicas."}' } }] }; } };
  };
  const result = await askGuideWithOpenAI(
    { question: "¿Dónde va el vidrio?", history: [], materialContext: "" },
    { balance: 120, scanCount: 5, deliveryCount: 2, activeCenters: 3, pointsPolicyEnabled: false },
    "test-key",
    "gpt-test",
    fakeFetch,
  );
  assert.deepEqual(result, { answer: "Separa vidrio limpio y seco, sin tapas metálicas.", source: "ai" });
  assert.equal(captured.store, false);
  assert.equal(captured.messages[0].role, "system");
  assert.match(captured.messages[0].content, /EcoGuía/);
  assert.match(captured.messages[0].content, /EcoPuntos disponibles: 120/);
  assert.match(captured.messages[0].content, /Centros activos publicados: 3/);
  assert.equal(captured.response_format.json_schema.strict, true);
});

test("guide quota caps repeated calls", () => {
  const acc = `guide-${Math.random()}`;
  for (let i = 0; i < 20; i += 1) assert.equal(consumeGuideQuota(acc), true);
  assert.equal(consumeGuideQuota(acc), false);
});

test("askGuideWithProvider (production path) builds authorized messages and returns ai answer", async () => {
  let captured;
  const fakeFetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return { ok: true, async json() { return { choices: [{ message: { content: '{"answer":"Separa el vidrio limpio y seco en el contenedor indicado."}' } }] }; } };
  };
  const cfg = {
    provider: "openrouter",
    apiKey: "test-key",
    chatModel: "nvidia/nemotron-3-super-120b-a12b:free",
    visionModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    timeoutMs: 15000,
    maxRetries: 0,
    retryBackoffMs: 100,
    visionMaxTokens: 1000,
    chatMaxTokens: 2000,
    requireOpenLicense: true,
  };
  const result = await askGuideWithProvider(
    { question: "¿Cómo separo el vidrio?", history: [{ role: "user", content: "Hola" }], materialContext: "" },
    { balance: 50, scanCount: 3, deliveryCount: 1, activeCenters: 2, pointsPolicyEnabled: false },
    cfg,
    fakeFetch,
  );
  assert.deepEqual(result, { answer: "Separa el vidrio limpio y seco en el contenedor indicado.", source: "ai" });
  assert.equal(captured.model, "nvidia/nemotron-3-super-120b-a12b:free");
  assert.equal(captured.store, false);
  assert.equal(captured.max_tokens, 2000);
  assert.equal(captured.messages[0].role, "system");
  assert.match(captured.messages[0].content, /EcoGuía/);
  assert.match(captured.messages[0].content, /EcoPuntos disponibles: 50/);
  assert.match(captured.messages[0].content, /Política de EcoPuntos por entrega verificada: inactiva en este entorno/);
  assert.equal(captured.response_format.json_schema.strict, true);
  assert.equal(captured.response_format.json_schema.schema.required[0], "answer");
});

test("askGuideWithProvider propagates provider 429 as ai_rate_limited with status 429", async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, async text() { return "{\"error\":{\"code\":429}}"; } });
  const cfg = {
    provider: "openrouter",
    apiKey: "test-key",
    chatModel: "nvidia/nemotron-3-super-120b-a12b:free",
    visionModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    timeoutMs: 5000,
    maxRetries: 0,
    retryBackoffMs: 50,
    visionMaxTokens: 1000,
    chatMaxTokens: 2000,
    requireOpenLicense: true,
  };
  await assert.rejects(
    () => askGuideWithProvider(
      { question: "¿Dónde va el vidrio?", history: [], materialContext: "" },
      { balance: 0, scanCount: 0, deliveryCount: 0, activeCenters: 0, pointsPolicyEnabled: false },
      cfg,
      fakeFetch,
    ),
    (err) => err.status === 429 && err.code === "ai_rate_limited",
  );
});

test("askGuideWithOpenAI rejects empty apiKey with ai_provider_unconfigured", async () => {
  await assert.rejects(
    () => askGuideWithOpenAI(
      { question: "Hola", history: [], materialContext: "" },
      { balance: 0, scanCount: 0, deliveryCount: 0, activeCenters: 0, pointsPolicyEnabled: false },
      "",
      "some-model",
    ),
    (err) => err instanceof AiGuideError && err.status === 503 && err.code === "ai_provider_unconfigured",
  );
});

test("general and account questions use remote AI with bounded, authenticated facts and six turns", async () => {
  const options = { categories: [{ code: "plastic" }], points: [{ name: "Centro publicado", address: "Calle 1", municipality: "Bogotá", materials: ["plastic"], slots: [{ startsAt: new Date("2026-11-01T14:00:00Z") }] }] };
  const deliveries = [{ status: "pending", materials: [{ categoryCode: "plastic" }], deliveryPoint: { name: "Centro publicado" } }];
  const details = guideAccountDetails(options, deliveries);
  const context = { balance: 0, scanCount: 1, deliveryCount: 1, activeCenters: 1, pointsPolicyEnabled: false, ...details };
  assert.match(guideSystemPrompt(context), /preguntas generales/);
  assert.match(guideSystemPrompt(context), /Centro publicado/);
  assert.match(guideSystemPrompt(context), /2026-11-01T14:00:00.000Z/);
  const cfg = { provider: "openrouter", apiKey: "test-key", chatModel: "nvidia/nemotron-3-super-120b-a12b:free", visionModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", timeoutMs: 5000, maxRetries: 0, retryBackoffMs: 1, visionMaxTokens: 1000, chatMaxTokens: 2000, requireOpenLicense: true };
  for (const question of ["¿Por qué es azul el cielo?", "¿Cuáles son mis EcoPuntos y mi entrega?"]) {
    let outbound;
    const result = await askGuideWithProvider({ question, history: Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Turno ${i}` })), materialContext: "" }, context, cfg, async (_url, init) => {
      outbound = JSON.parse(init.body);
      return { ok: true, status: 200, async json() { return { choices: [{ message: { content: '{"answer":"Respuesta remota de prueba."}' } }] }; } };
    });
    assert.equal(result.source, "ai");
    assert.equal(outbound.messages.length, 9); // 2 system, 6 earlier turns, current question
    assert.equal(outbound.messages.at(-1).content, question);
    assert.match(outbound.messages[0].content, /Centro publicado/);
    assert.match(outbound.messages[0].content, /EcoPuntos disponibles: 0/);
  }
});
