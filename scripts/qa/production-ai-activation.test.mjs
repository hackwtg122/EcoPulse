import assert from "node:assert/strict";
import test from "node:test";
import { activateStructuredAI, validateStructuredFreeModel, structuredFreeModel, aiMarker, aiRevision, aiLiveMarker } from "./production-ai-activation.mjs";

const catalog = () => ({ data: [{ id: structuredFreeModel, pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["response_format", "structured_outputs"] }] });
function adapter(initial = []) {
  const env = new Map([["PILOT_AI_ENABLED", "true"], ["AI_TIMEOUT_MS", "45000"], ["AI_MAX_RETRIES", "1"], ["AI_MAX_TOKENS_VISION", "2048"], ...initial]), writes = [];
  return { env, writes, readEnvironment: async () => new Map(env), readCatalog: async () => catalog(),
    setVariable: async (key, value) => { writes.push([key, value]); env.set(key, value); } };
}
test("only verified model settings and revision change; keys and value gates remain untouched", async () => {
  const api = adapter([["AI_API_KEY", "private-sentinel"]]);
  const result = await activateStructuredAI(api);
  assert.deepEqual(api.writes, [["AI_CHAT_MODEL", structuredFreeModel], ["AI_VISION_MODEL", structuredFreeModel], [aiMarker, aiRevision]]);
  assert.equal(result.deployRequired, true);
  assert.ok(!JSON.stringify(result).includes("private-sentinel"));
});
test("live catalog must confirm zero pricing, both modalities and strict structured outputs", () => {
  for (const mutate of [m => { m.pricing.prompt = "0.1"; }, m => { m.pricing.image = "1"; },
    m => { m.architecture.input_modalities = ["text"]; }, m => { m.supported_parameters = []; }]) {
    const data = catalog(); mutate(data.data[0]); assert.throws(() => validateStructuredFreeModel(data));
  }
  assert.throws(() => validateStructuredFreeModel({ data: [] }));
});
test("custom providers, bases, models and disabled AI cannot be silently overwritten", async () => {
  for (const config of [[["AI_PROVIDER", "nvidia"]], [["AI_BASE_URL", "https://other.invalid"]],
    [["AI_CHAT_MODEL", "private-model-sentinel"]], [["PILOT_AI_ENABLED", "false"]]]) {
    const api = adapter(config), result = await activateStructuredAI(api);
    assert.equal(result.status, "BLOCKED"); assert.deepEqual(api.writes, []);
    assert.ok(!JSON.stringify(result).includes("private-model-sentinel"));
  }
});
test("later deployments preserve operator model overrides and do not call providers", async () => {
  const api = adapter([[aiMarker, aiRevision], [aiLiveMarker, aiRevision], ["AI_CHAT_MODEL", "custom-operator-model"]]);
  api.readCatalog = async () => { throw new Error("must-not-call"); };
  const result = await activateStructuredAI(api);
  assert.equal(result.deployRequired, false); assert.deepEqual(api.writes, []);
});
test("an unavailable catalog or partial update cannot complete the activation", async () => {
  const api = adapter(); api.readCatalog = async () => { throw new Error("unavailable"); };
  await assert.rejects(activateStructuredAI(api)); assert.deepEqual(api.writes, []);
  const other = adapter(); other.setVariable = async () => {};
  await assert.rejects(activateStructuredAI(other), /structured_ai_activation_not_confirmed/);
});

test("only legacy runtime defaults are upgraded; quotas and operator limits are never raised", async () => {
  const api = adapter([["AI_TIMEOUT_MS", "15000"], ["AI_MAX_RETRIES", "2"], ["AI_MAX_TOKENS_VISION", "1000"], ["AI_DAILY_PER_USER_FREE_REQ", "3"]]);
  await activateStructuredAI(api);
  assert.equal(api.env.get("AI_TIMEOUT_MS"), "45000");
  assert.equal(api.env.get("AI_MAX_RETRIES"), "1");
  assert.equal(api.env.get("AI_MAX_TOKENS_VISION"), "2048");
  assert.equal(api.env.get("AI_DAILY_PER_USER_FREE_REQ"), "3");
  const custom = adapter([["AI_TIMEOUT_MS", "25000"], ["AI_MAX_RETRIES", "0"], ["AI_MAX_TOKENS_VISION", "4096"]]);
  await activateStructuredAI(custom);
  assert.ok(custom.writes.every(([key]) => !["AI_TIMEOUT_MS", "AI_MAX_RETRIES", "AI_MAX_TOKENS_VISION"].includes(key)));
});
