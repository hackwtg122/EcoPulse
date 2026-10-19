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

const remoteEnabled = process.env.AI_GUIDE_REMOTE_TEST === "true";
const apiKey = process.env.AI_API_KEY || "";

// This test performs ONE real call to OpenRouter. It is skipped by default
// to avoid consuming the free-tier quota on every suite run. Enable with:
//   AI_GUIDE_REMOTE_TEST=true npx tsx --test src/lib/aiGuide.remote.test.mjs
test("remote: askGuideWithProvider returns a real answer from OpenRouter", { skip: !remoteEnabled || !apiKey }, async () => {
  const { askGuideWithProvider } = await import("./aiGuide.ts");
  const cfg = {
    provider: "openrouter",
    apiKey,
    chatModel: process.env.AI_CHAT_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
    visionModel: process.env.AI_VISION_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
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
    // Strip Authorization before any logging (never printed here).
    return fetch(url, options);
  };

  const result = await askGuideWithProvider(
    {
      question: "¿Cómo separo el vidrio para reciclar?",
      history: [],
      materialContext: "",
    },
    {
      balance: 10,
      scanCount: 2,
      deliveryCount: 1,
      activeCenters: 3,
      pointsPolicyEnabled: false,
    },
    cfg,
    wrappedFetch,
  );

  // Verify the outgoing request shape.
  assert.equal(capturedBody.model, cfg.chatModel);
  assert.equal(capturedBody.store, false);
  assert.equal(capturedBody.response_format.json_schema.strict, true);
  assert.equal(capturedBody.messages[0].role, "system");
  assert.match(capturedBody.messages[0].content, /EcoGuía/);
  assert.match(capturedBody.messages[0].content, /EcoPuntos disponibles: 10/);

  // Verify the real answer.
  assert.equal(result.source, "ai");
  assert.ok(typeof result.answer === "string" && result.answer.length > 0, "answer must be non-empty");
  assert.ok(result.answer.length <= 800, `answer length ${result.answer.length} must be <= 800`);
});
