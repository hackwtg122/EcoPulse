import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local for the remote test (only when explicitly enabled).
const envPath = resolve(process.cwd(), "../../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}

const remoteEnabled = process.env.AI_SCAN_REMOTE_TEST === "true";
const apiKey = process.env.AI_API_KEY || "";
const fixturePath = resolve(process.cwd(), "src/lib/fixtures/plastic-water-bottle.png");

// Real photograph used for the remote vision check:
// "Plastic Water Bottle.jpg" by Kykywinks, Wikimedia Commons, CC BY-SA 4.0.
// Converted to PNG locally; the pipeline only accepts sanitized PNG pixels.
//
// This test performs ONE real call to OpenRouter. It is skipped by default
// to avoid consuming the free-tier quota on every suite run. Enable with:
//   AI_SCAN_REMOTE_TEST=true npx tsx --test src/lib/aiScan.remote.test.mjs
test("remote: classifyImageWithVision classifies a real photograph from OpenRouter", { skip: !remoteEnabled || !apiKey || !existsSync(fixturePath) }, async () => {
  const { sanitizePng } = await import("./aiClassification.ts");
  const { classifyImageWithVision } = await import("./aiProvider.ts");

  // Same validation path used by POST /api/pilot/scans/ai-classify.
  const sanitized = sanitizePng(readFileSync(fixturePath));
  const imageBase64 = sanitized.toString("base64");

  const cfg = {
    provider: "openrouter",
    apiKey,
    visionModel: process.env.AI_VISION_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    chatModel: process.env.AI_CHAT_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 20000,
    maxRetries: Number(process.env.AI_MAX_RETRIES) || 2,
    retryBackoffMs: Number(process.env.AI_RETRY_BACKOFF_MS) || 500,
    visionMaxTokens: Number(process.env.AI_MAX_TOKENS_VISION) || 1000,
    chatMaxTokens: Number(process.env.AI_MAX_TOKENS_CHAT) || 2000,
    requireOpenLicense: true,
  };

  // Wrap fetch to capture the outgoing request without printing the key.
  let capturedBody;
  const wrappedFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return fetch(url, options);
  };

  const result = await classifyImageWithVision(cfg, imageBase64, wrappedFetch);

  // Verify the outgoing request shape.
  assert.equal(capturedBody.model, cfg.visionModel);
  assert.equal(capturedBody.store, false);
  assert.equal(capturedBody.response_format.json_schema.strict, true);
  assert.ok(Array.isArray(capturedBody.messages), "messages must be sent");
  assert.ok(!JSON.stringify(capturedBody).includes(apiKey), "the API key must never appear in the payload");

  // Verify the real answer is a strict suggestion: plastic bottle photo.
  assert.equal(result.source, "ai_suggestion");
  assert.equal(result.persisted, false);
  assert.equal(result.points, 0);
  assert.equal(result.category, "plastic", `expected plastic for a plastic bottle photo, got ${result.category}`);
  assert.ok(typeof result.explanation === "string" && result.explanation.length > 0, "explanation must be non-empty");
  assert.ok(["high", "medium", "low", null].includes(result.confidence), "confidence must be grounded");
  assert.equal(typeof result.ambiguous, "boolean");
});
