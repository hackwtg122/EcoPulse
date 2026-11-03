import { VERIFIED_FREE_OPEN_MODELS, type ProviderConfig } from "./aiProvider.ts";

export const NVIDIA_CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export const NVIDIA_VISION_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
export const NVIDIA_NIM_BASE = "https://integrate.api.nvidia.com/v1";

type AiKind = "ecoscan" | "ecoguide";
type Env = Record<string, string | undefined>;

export function resolveAiSettings(kind: AiKind, env: Env): {
  provider: ProviderConfig["provider"] | null;
  model: string;
  apiKey: string;
  baseUrl?: string;
  missing: string[];
} {
  const missing: string[] = [];
  if (env.PILOT_AI_ENABLED !== "true") missing.push("PILOT_AI_ENABLED");
  const provider = env.AI_PROVIDER || "openrouter";
  if (provider === "nvidia") {
    // Gate stays closed until both model formats and trial terms are verified
    // with authorized, quota-bounded calls. Never infer paid access from a key.
    if (env.NVIDIA_NIM_VERIFIED !== "true") missing.push("NVIDIA_NIM_VERIFIED");
    const apiKey = env.NVIDIA_API_KEY || "";
    if (!apiKey) missing.push("NVIDIA_API_KEY");
    const model = kind === "ecoscan" ? env.NVIDIA_VISION_MODEL : env.NVIDIA_CHAT_MODEL;
    const expected = kind === "ecoscan" ? NVIDIA_VISION_MODEL : NVIDIA_CHAT_MODEL;
    if (model !== expected) missing.push(kind === "ecoscan" ? "NVIDIA_VISION_MODEL" : "NVIDIA_CHAT_MODEL");
    return { provider: "nvidia", apiKey, model: model || "", baseUrl: NVIDIA_NIM_BASE, missing };
  }
  if (provider !== "openrouter") missing.push("AI_PROVIDER");
  if (env.AI_BASE_URL && env.AI_BASE_URL.replace(/\/$/, "") !== "https://openrouter.ai/api/v1") missing.push("AI_BASE_URL");
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY || "";
  if (!apiKey) missing.push("AI_API_KEY");
  // The current public catalog confirms zero pricing and strict structured
  // outputs for this already-allowlisted text/image model. Do not route to the
  // retired chat default or a random provider selected by openrouter/free.
  const model = (kind === "ecoscan" ? env.AI_VISION_MODEL : env.AI_CHAT_MODEL)
    || "nvidia/nemotron-3.5-super-vl:free";
  if (!(VERIFIED_FREE_OPEN_MODELS as readonly string[]).includes(model)) missing.push(kind === "ecoscan" ? "AI_VISION_MODEL" : "AI_CHAT_MODEL");
  return { provider: provider === "openrouter" ? "openrouter" : null, model, apiKey, missing };
}
