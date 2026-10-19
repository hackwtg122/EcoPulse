import { chatWithStructured, type ProviderConfig } from "./aiProvider.ts";
import { AiGuideError, type GuideRole, type GuideTurn, type GuideRequest, type GuideUserContext, type AiGuideResult, guideSystemPrompt } from "./aiGuideCore.ts";
export { AiGuideError, type GuideRole, type GuideTurn, type GuideRequest, type GuideUserContext, type AiGuideResult } from "./aiGuideCore.ts";
export { guideSystemPrompt, parseGuideRequest } from "./aiGuideCore.ts";

export async function askGuideWithProvider(request: GuideRequest, context: GuideUserContext, cfg: ProviderConfig, fetchImpl?: typeof fetch): Promise<AiGuideResult> {
  const sys = guideSystemPrompt(context);
  const res = await chatWithStructured(cfg, sys, request.history as any, request.question, request.materialContext || undefined, fetchImpl);
  return { answer: res.answer, source: "ai" };
}

export async function askGuideWithOpenAI(
  request: GuideRequest,
  context: GuideUserContext,
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AiGuideResult> {
  if (!apiKey) throw new AiGuideError(503, "ai_provider_unconfigured");
  const cfg: ProviderConfig = {
    provider: "openrouter",
    apiKey,
    visionModel: model,
    chatModel: model,
    timeoutMs: 15000,
    maxRetries: 2,
    retryBackoffMs: 500,
    visionMaxTokens: 220,
    // Verified against the live provider: the current free open chat models are
    // reasoning models that spend budget on internal reasoning before the visible
    // answer; with a low limit the response comes back with content: null
    // (finish_reason "length") and is rejected as invalid_ai_response.
    chatMaxTokens: 2000,
    requireOpenLicense: false,
  };
  const sys = guideSystemPrompt(context);
  const res = await chatWithStructured(cfg, sys, request.history as any, request.question, request.materialContext || undefined, fetchImpl);
  return { answer: res.answer, source: "ai" };
}

const guideWindowMs = 60_000;
const guideQuotaLimit = 20;
const guideQuota = new Map<string, { start: number; count: number }>();

export function consumeGuideQuota(userId: string, now = Date.now()): boolean {
  if (guideQuota.size > 1000) {
    for (const [key, entry] of guideQuota) {
      if (now - entry.start >= guideWindowMs) guideQuota.delete(key);
    }
  }
  const entry = guideQuota.get(userId);
  if (!entry || now - entry.start >= guideWindowMs) {
    guideQuota.set(userId, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= guideQuotaLimit;
}
