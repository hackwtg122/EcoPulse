import assert from "node:assert/strict";

export const structuredFreeModel = "nvidia/nemotron-3.5-super-vl:free";
export const aiRevision = "congress-structured-free-v2";
export const aiMarker = "ECOPULSE_AI_ACTIVATION_REVISION";
export const aiLiveMarker = "ECOPULSE_AI_ACTIVATION_LIVE_REVISION";
const legacyModels = new Set(["openrouter/free", "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", structuredFreeModel]);

export function validateStructuredFreeModel(catalog) {
  const model = catalog?.data?.find(row => row.id === structuredFreeModel);
  assert.ok(model, "verified_free_model_not_in_current_catalog");
  assert.equal(model.pricing?.prompt, "0", "model_prompt_not_free");
  assert.equal(model.pricing?.completion, "0", "model_completion_not_free");
  assert.ok(Object.values(model.pricing).every(value => Number(value) === 0), "additional_model_price_not_free");
  assert.ok(model.architecture?.input_modalities?.includes("image") && model.architecture?.input_modalities?.includes("text"), "model_modalities_unavailable");
  assert.ok(model.supported_parameters?.includes("response_format") && model.supported_parameters?.includes("structured_outputs"), "model_structured_output_unavailable");
}

export async function activateStructuredAI({ readEnvironment, setVariable, readCatalog }) {
  const environment = await readEnvironment();
  const alreadyApplied = environment.get(aiMarker) === aiRevision;
  const changed = [];
  if (!alreadyApplied) {
    const provider = environment.get("AI_PROVIDER") || "openrouter";
    if (provider !== "openrouter" || (environment.get("AI_BASE_URL") || "https://openrouter.ai/api/v1").replace(/\/$/, "") !== "https://openrouter.ai/api/v1") {
      return { check: "production_structured_ai_activation", status: "BLOCKED", reason: "custom_provider_requires_separate_validation", deployRequired: false };
    }
    if (environment.get("PILOT_AI_ENABLED") !== "true") {
      return { check: "production_structured_ai_activation", status: "BLOCKED", reason: "operator_ai_kill_switch_preserved", deployRequired: false };
    }
    for (const flag of ["AI_CHAT_MODEL", "AI_VISION_MODEL"]) {
      if (environment.has(flag) && !legacyModels.has(environment.get(flag))) {
        return { check: "production_structured_ai_activation", status: "BLOCKED", reason: "custom_model_configuration_preserved", deployRequired: false };
      }
    }
    // Public catalog metadata only: no key, input image or account data is sent.
    validateStructuredFreeModel(await readCatalog());
    const runtimeChanges = [];
    // Upgrade only the former sample defaults. Respect deliberate operator
    // limits and never raise user/global daily quotas to make a test pass.
    for (const [flag, previous, value] of [["AI_TIMEOUT_MS", "15000", "45000"],
      ["AI_MAX_RETRIES", "2", "1"], ["AI_MAX_TOKENS_VISION", "1000", "2048"]]) {
      if (!environment.has(flag) || environment.get(flag) === previous) {
        await setVariable(flag, value);
        changed.push(flag);
        runtimeChanges.push([flag, value]);
      }
    }
    for (const flag of ["AI_CHAT_MODEL", "AI_VISION_MODEL"]) {
      if (environment.get(flag) !== structuredFreeModel) {
        await setVariable(flag, structuredFreeModel);
        changed.push(flag);
      }
    }
    const updated = await readEnvironment();
    assert.ok(["AI_CHAT_MODEL", "AI_VISION_MODEL"].every(flag => updated.get(flag) === structuredFreeModel), "structured_ai_activation_not_confirmed");
    assert.ok(runtimeChanges.every(([flag, value]) => updated.get(flag) === value), "ai_runtime_limits_not_confirmed");
    await setVariable(aiMarker, aiRevision);
  }
  const confirmed = await readEnvironment();
  assert.equal(confirmed.get(aiMarker), aiRevision, "ai_activation_marker_not_confirmed");
  return { check: "production_structured_ai_activation", status: "PASS", scope: "configuration_only_not_inference",
    revision: aiRevision, alreadyApplied, changed, deployRequired: confirmed.get(aiLiveMarker) !== aiRevision };
}
