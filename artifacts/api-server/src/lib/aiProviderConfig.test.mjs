import assert from "node:assert/strict";
import test from "node:test";
import { NVIDIA_CHAT_MODEL, NVIDIA_VISION_MODEL, NVIDIA_NIM_BASE, resolveAiSettings } from "./aiProviderConfig.ts";

test("OpenRouter stays the default and NVIDIA cannot activate without an explicit verified trial gate", () => {
  const open = resolveAiSettings("ecoguide", { PILOT_AI_ENABLED: "true", AI_API_KEY: "unit-key" });
  assert.equal(open.provider, "openrouter");
  assert.equal(open.missing.length, 0);
  assert.match(open.model, /:free$/);
  assert.equal(open.model, "nvidia/nemotron-3.5-super-vl:free");
  const vision = resolveAiSettings("ecoscan", { PILOT_AI_ENABLED: "true", AI_API_KEY: "unit-key" });
  assert.equal(vision.model, open.model);
  assert.deepEqual(vision.missing, []);
  const unready = resolveAiSettings("ecoscan", { PILOT_AI_ENABLED: "true", AI_PROVIDER: "nvidia", NVIDIA_API_KEY: "unit-key", NVIDIA_VISION_MODEL });
  assert.deepEqual(unready.missing, ["NVIDIA_NIM_VERIFIED"]);
  const noKey = resolveAiSettings("ecoguide", { PILOT_AI_ENABLED: "true", AI_PROVIDER: "nvidia", NVIDIA_NIM_VERIFIED: "true", NVIDIA_CHAT_MODEL });
  assert.deepEqual(noKey.missing, ["NVIDIA_API_KEY"]);
  const wrongModel = resolveAiSettings("ecoscan", { PILOT_AI_ENABLED: "true", AI_PROVIDER: "nvidia", NVIDIA_NIM_VERIFIED: "true", NVIDIA_API_KEY: "unit-key", NVIDIA_VISION_MODEL: "nvidia/other" });
  assert.ok(wrongModel.missing.includes("NVIDIA_VISION_MODEL"));
  const wrongProvider = resolveAiSettings("ecoguide", { PILOT_AI_ENABLED: "true", AI_PROVIDER: "unknown", AI_API_KEY: "unit-key" });
  assert.ok(wrongProvider.missing.includes("AI_PROVIDER"));
});

test("both official NIM models require exact configuration and a fixed host", () => {
  const common = { PILOT_AI_ENABLED: "true", AI_PROVIDER: "nvidia", NVIDIA_NIM_VERIFIED: "true", NVIDIA_API_KEY: "unit-key", AI_BASE_URL: "https://not-nvidia.invalid" };
  const chat = resolveAiSettings("ecoguide", { ...common, NVIDIA_CHAT_MODEL });
  const vision = resolveAiSettings("ecoscan", { ...common, NVIDIA_VISION_MODEL });
  assert.equal(chat.model, NVIDIA_CHAT_MODEL);
  assert.equal(vision.model, NVIDIA_VISION_MODEL);
  assert.equal(chat.baseUrl, NVIDIA_NIM_BASE);
  assert.equal(vision.baseUrl, NVIDIA_NIM_BASE);
  assert.deepEqual(chat.missing, []);
  assert.deepEqual(vision.missing, []);
});
