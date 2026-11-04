import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAiSettings, resolveAiRuntimeLimits } from "../../artifacts/api-server/src/lib/aiProviderConfig.ts";
import { chatWithStructured, classifyImageWithVision } from "../../artifacts/api-server/src/lib/aiProvider.ts";
import { sanitizePng } from "../../artifacts/api-server/src/lib/aiClassification.ts";

// Explicit opt-in: real calls consume provider quota. No sessions, account
// facts, operational records, saved classifications or fabricated responses.
assert.equal(process.env.AI_LIVE_VERIFY, "true", "Set AI_LIVE_VERIFY=true to authorize real provider calls");
for (const kind of ["ecoguide", "ecoscan"]) {
  const settings = resolveAiSettings(kind, process.env);
  assert.deepEqual(settings.missing, [], `${kind}: provider configuration incomplete`);
  const config = {
    provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl,
    visionModel: settings.model, chatModel: settings.model, requireOpenLicense: true,
    ...resolveAiRuntimeLimits(process.env), maxRetries: Math.min(1, resolveAiRuntimeLimits(process.env).maxRetries),
    ...(settings.provider === "openrouter" ? { fallbackModel: "nvidia/nemotron-3.5-super-vl:free" } : {}),
  };
  const attempts = [];
  const realFetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    const response = await fetch(url, options);
    attempts.push({ model, http: response.status });
    return response;
  };
  try {
    if (kind === "ecoguide") {
      const result = await chatWithStructured(config,
        "Eres EcoGuía. Orienta sobre separación de residuos en Colombia. No tienes datos de cuenta ni catálogo: no inventes centros, saldos, horarios ni entregas.",
        [], "¿Cómo separo el vidrio para reciclar?", undefined, realFetch);
      assert.ok(result.answer.length > 0 && result.answer.length <= 800);
      console.log(JSON.stringify({ kind, status: "PASS", scope: "direct_provider_only", attempts, answerLength: result.answer.length }));
    } else {
      // Real licensed photograph already in this repository, not an image mock:
      // Plastic Water Bottle.jpg, Kykywinks, Wikimedia Commons, CC BY-SA 4.0.
      const image = sanitizePng(await readFile(new URL("../../artifacts/api-server/src/lib/fixtures/plastic-water-bottle.png", import.meta.url)));
      const result = await classifyImageWithVision(config, image.toString("base64"), realFetch);
      assert.equal(result.source, "ai_suggestion");
      assert.equal(result.persisted, false);
      assert.equal(result.points, 0);
      assert.equal(result.category, "plastic");
      console.log(JSON.stringify({ kind, status: "PASS", scope: "direct_provider_only", attempts, category: result.category, persisted: false, points: 0 }));
    }
  } catch (error) {
    // Do not emit arbitrary exception messages, keys, images or model output.
    console.log(JSON.stringify({ kind, status: "FAIL", scope: "direct_provider_only", attempts,
      reason: error?.constructor?.name === "AiProviderError" ? error.code : "live_verification_failed" }));
    process.exitCode = 1;
  }
}
