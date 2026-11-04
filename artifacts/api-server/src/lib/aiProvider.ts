const safeAiDiagnostics = new Set(["output_truncated", "empty_content", "json_syntax_invalid", "vision_shape_invalid", "vision_confidence_invalid", "vision_explanation_invalid"]);
export class AiProviderError extends Error {
  readonly status: number;
  readonly code: string;
  /** Provider-advertised or window-based wait before retrying, when known. */
  readonly retryAfterSeconds?: number;
  readonly diagnostic?: string;
  constructor(status: number, code: string, retryAfterSeconds?: number, diagnostic?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    if (diagnostic && safeAiDiagnostics.has(diagnostic)) this.diagnostic = diagnostic;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// OpenRouter advertises the wait on rate limits (either seconds or an HTTP
// date). Best effort: an unreadable header simply leaves the wait unknown.
function parseRetryAfter(headers: unknown): number | undefined {
  const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
  if (typeof get !== "function") return undefined;
  let raw: string | null;
  try { raw = get.call(headers, "retry-after"); } catch { return undefined; }
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

export type ProviderConfig = {
  provider: "openrouter" | "nvidia" | "groq" | "custom";
  apiKey: string;
  baseUrl?: string;
  visionModel: string;
  chatModel: string;
  visionAllowlist?: string[];
  chatAllowlist?: string[];
  /** Explicit, verified free structured-output model for a retired endpoint (404). */
  fallbackModel?: string;
  requireOpenLicense?: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  visionMaxTokens: number;
  chatMaxTokens: number;
  /** Must durably reserve one attempt before every chat/completions request. */
  beforeAttempt?: (model: string, attempt: number) => string | void | Promise<string | void>;
  afterAttempt?: (id: string, status: string, durationMs: number, errorCode?: string) => void | Promise<void>;
};

type ClassifyVisionPayload = {
  category: "paper" | "plastic" | "glass" | "metal" | "organic" | "other" | "unknown";
  explanation: string;
  ambiguous: boolean;
  confidence: "high" | "medium" | "low" | null;
};

export type ClassifyVisionResult = ClassifyVisionPayload & {
  source: "ai_suggestion";
  persisted: false;
  points: 0;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
// Free open models present in the official public catalog (GET /api/v1/models,
// verified 2026-10-18: each id exists with prompt/completion price "0" and, for the
// vision picks, image input support). Existence and price are catalog facts, not a
// commitment: free endpoints can change availability, rate limits or behavior at any
// time, so the server keeps the manual fallback and the configuration gate closed.
// Chat: nvidia/nemotron-3-super-120b-a12b:free — text-only, JSON schema.
// Vision: nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free — images + JSON schema (reasoning models need enough output tokens).
// Vision backup: nvidia/nemotron-3.5-super-vl:free — images + JSON schema.
export const VERIFIED_FREE_OPEN_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3.5-super-vl:free",
] as const;
const OPEN_MODEL_ALLOWLIST = new Set<string>(VERIFIED_FREE_OPEN_MODELS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number): number {
  const j = Math.floor(Math.random() * 200) - 100;
  const v = ms + j;
  return v > 0 ? v : ms;
}

function resolveBaseUrl(cfg: ProviderConfig): string {
  // NIM must never be redirected to a configurable host carrying its key.
  if (cfg.provider === "nvidia") return "https://integrate.api.nvidia.com/v1";
  if (cfg.baseUrl && cfg.baseUrl.trim()) return cfg.baseUrl.trim().replace(/\/$/, "");
  if (cfg.provider === "openrouter") return OPENROUTER_BASE;
  if (cfg.provider === "groq") return "https://api.groq.com/openai/v1";
  throw new AiProviderError(500, "ai_provider_invalid");
}

function isTransientError(status: number, err: unknown): boolean {
  if (err instanceof Error && (err.name === "AbortError" || (err as any).code === "aborted")) return true;
  if (status === 408 || status === 425) return true;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function selectModel(
  requested: string,
  allowlist: string[] | undefined,
  requireOpen: boolean | undefined,
  provider: ProviderConfig["provider"] = "openrouter",
): string {
  if (!requested) throw new AiProviderError(503, "ai_provider_unconfigured");
  const model = requested.trim();
  if (provider === "nvidia") {
    if (model === "nvidia/nemotron-3-super-120b-a12b" || model === "nvidia/nemotron-3.5-super-vl-120b-a12b") return model;
    throw new AiProviderError(503, "ai_provider_model_not_allowed");
  }
  const req = requireOpen !== false;

  if (model === "openrouter/free") {
    if (req) {
      // Try allowlist first (only verified :free)
      if (allowlist && allowlist.length > 0) {
        const m = allowlist.find((x) => x.includes(":free") && OPEN_MODEL_ALLOWLIST.has(x));
        if (m) return m;
      }
      throw new AiProviderError(503, "ai_provider_no_verified_free_open_model");
    }
    return model;
  }

  if (req) {
    if (OPEN_MODEL_ALLOWLIST.has(model)) return model;
    // Operator configuration may narrow the free set, never admit a paid model.
    // A supplied allowlist is not proof of pricing or license.
    if (allowlist?.includes(model)) throw new AiProviderError(503, "ai_provider_model_not_verified");
    if (model.includes(":free")) throw new AiProviderError(503, "ai_provider_model_not_verified");
    throw new AiProviderError(503, "ai_provider_model_not_allowed");
  }
  return model;
}

async function chatCompletions(
  cfg: ProviderConfig,
  model: string,
  messages: Array<{ role: string; content: any }>,
  responseSchema: any,
  maxTokens: number,
  signal?: AbortController["signal"],
  fetchImpl: typeof fetch = fetch,
): Promise<any> {
  const base = resolveBaseUrl(cfg);
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: cfg.provider === "nvidia" ? (model.includes("super-vl") ? 0.6 : 1.0) : 0.2,
    ...(cfg.provider === "openrouter" ? {
      // Route only to free endpoints that actually honor the requested schema.
      provider: { require_parameters: true, max_price: { prompt: 0, completion: 0 } },
      reasoning: { effort: "low", exclude: true },
    } : {}),
    ...(cfg.provider === "nvidia" ? { top_p: 0.95, stream: false } : { response_format: {
      type: "json_schema",
      json_schema: {
        name: "ecopulse_schema",
        strict: true,
        schema: responseSchema,
      },
    } }),
  };
  // NVIDIA's model-specific response_format support is unverified: request
  // JSON explicitly and validate the result locally rather than send a schema
  // option that might be rejected. Keep OpenRouter's existing strict contract.
  const bodyWithStore = cfg.provider === "nvidia"
    ? { ...body, messages: [{ role: "system", content: `Devuelve únicamente un objeto JSON válido con este esquema (sin markdown ni explicaciones): ${JSON.stringify(responseSchema)}` }, ...messages] }
    : { store: false, ...body };
  let lastStatus = 0;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let reservationId: string | void = undefined;
    let attemptStatus = "network_error";
    let attemptError: string | undefined;
    const started = Date.now();
    try {
      if (cfg.beforeAttempt) reservationId = await cfg.beforeAttempt(model, attempt + 1);
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          // Optional app attribution header documented by OpenRouter; contains no secrets.
          "X-Title": "EcoPulse",
        },
        body: JSON.stringify({ ...bodyWithStore, model }),
        signal: signal ?? controller.signal,
      });
      lastStatus = res.status;
      attemptStatus = String(res.status);
      if (res.ok) {
        const payload: any = await res.json();
        // More identical retries cannot repair an exhausted output budget.
        // Never parse a partial answer or expose provider content/reasoning.
        if (payload?.choices?.[0]?.finish_reason === "length") {
          throw new AiProviderError(502, "invalid_ai_response", undefined, "output_truncated");
        }
        const content = payload?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          attemptError = "invalid_ai_response";
          // Reasoning models may return null content transiently; treat as retryable.
          if (attempt < cfg.maxRetries) {
            clearTimeout(timer);
            const backoff = withJitter(cfg.retryBackoffMs * Math.pow(2, attempt));
            await sleep(backoff);
            continue;
          }
          throw new AiProviderError(502, "invalid_ai_response", undefined, "empty_content");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          attemptError = "invalid_ai_response";
          throw new AiProviderError(502, "invalid_ai_response", undefined, "json_syntax_invalid");
        }
        clearTimeout(timer);
        return parsed;
      }
      clearTimeout(timer);
      if (res.status === 404 && cfg.provider === "openrouter" && cfg.fallbackModel && model !== cfg.fallbackModel && attempt < cfg.maxRetries) {
        // This consumes the existing retry budget and must reserve its own quota
        // on the next iteration. Never fallback on auth, quota or invalid output.
        model = selectModel(cfg.fallbackModel, undefined, true, cfg.provider);
      } else if (!isTransientError(res.status, null) || res.status === 429 || attempt === cfg.maxRetries) {
        if (res.status === 401 || res.status === 403) throw new AiProviderError(503, "ai_provider_auth_failed");
        if (res.status === 404) throw new AiProviderError(503, "ai_provider_model_unavailable");
        if (res.status === 400) throw new AiProviderError(502, "ai_provider_rejected_request");
        throw new AiProviderError(
          res.status >= 500 ? 502 : res.status === 429 ? 429 : 502,
          res.status === 429 ? "ai_rate_limited" : "ai_provider_unavailable",
          res.status === 429 ? parseRetryAfter(res.headers) : undefined,
        );
      }
    } catch (e) {
      clearTimeout(timer);
      if (!(e instanceof AiProviderError)) attemptError = "ai_provider_unavailable";
      else attemptError = e.code;
      if (e instanceof AiProviderError || !isTransientError(0, e) || attempt === cfg.maxRetries) {
        // Keep already-classified errors intact so status, code and any
        // advertised wait (quota window or provider rate limit) reach the client.
        if (e instanceof AiProviderError) throw e;
        throw new AiProviderError(502, "ai_provider_unavailable");
      }
    } finally {
      if (reservationId && cfg.afterAttempt) {
        // Closing the audit row is bookkeeping: a store hiccup must never discard
        // a valid analysis nor mask the real provider error.
        try { await cfg.afterAttempt(reservationId, attemptStatus, Date.now() - started, attemptError); }
        catch { /* new attempts still fail closed in beforeAttempt */ }
      }
    }
    const backoff = withJitter(cfg.retryBackoffMs * Math.pow(2, attempt));
    await sleep(backoff);
  }
  throw new AiProviderError(lastStatus === 429 ? 429 : 502, lastStatus === 429 ? "ai_rate_limited" : "ai_provider_unavailable");
}

const visionCategories = new Set<ClassifyVisionPayload["category"]>(["paper", "plastic", "glass", "metal", "organic", "other", "unknown"]);
const confidenceLevels = new Set<NonNullable<ClassifyVisionPayload["confidence"]>>(["high", "medium", "low"]);

// Strict server-side re-validation. response_format is only a request to the model:
// any provider can ignore it, so the payload is checked field by field before it can
// reach the client. Extra fields (points, persistence claims) always fail.
export function parseVisionPayload(value: unknown): ClassifyVisionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiProviderError(502, "invalid_ai_response");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 || !["ambiguous", "category", "confidence", "explanation"].every((key) => Object.hasOwn(row, key))) {
    throw new AiProviderError(502, "invalid_ai_response", undefined, "vision_shape_invalid");
  }
  if (typeof row.category !== "string" || !visionCategories.has(row.category as ClassifyVisionPayload["category"])) {
    throw new AiProviderError(502, "invalid_ai_category");
  }
  if (typeof row.ambiguous !== "boolean") throw new AiProviderError(502, "invalid_ai_response");
  let confidence: ClassifyVisionPayload["confidence"] = null;
  if (row.confidence !== null) {
    if (typeof row.confidence !== "string" || !confidenceLevels.has(row.confidence as NonNullable<ClassifyVisionPayload["confidence"]>)) {
      throw new AiProviderError(502, "invalid_ai_response", undefined, "vision_confidence_invalid");
    }
    confidence = row.confidence as NonNullable<ClassifyVisionPayload["confidence"]>;
  }
  const explanation = typeof row.explanation === "string" ? row.explanation.trim().replace(/\s+/g, " ") : "";
  if (!explanation || explanation.length > 400) throw new AiProviderError(502, "invalid_ai_response", undefined, "vision_explanation_invalid");
  const category = row.category as ClassifyVisionPayload["category"];
  // Without a clear category there is no grounded assessment to display.
  if (category === "unknown" || row.ambiguous) return { category, explanation, ambiguous: true, confidence: null };
  return { category, explanation, ambiguous: false, confidence };
}

export async function classifyImageWithVision(
  cfg: ProviderConfig,
  pngBase64: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClassifyVisionResult> {
  // Defense in depth: never call the provider without a configured server-side key.
  if (!cfg.apiKey) throw new AiProviderError(503, "ai_provider_unconfigured");
  const model = selectModel(cfg.visionModel, cfg.visionAllowlist, cfg.requireOpenLicense, cfg.provider);
  if (cfg.provider === "nvidia" && model !== "nvidia/nemotron-3.5-super-vl-120b-a12b") throw new AiProviderError(503, "ai_provider_model_not_allowed");
  const schema = {
    type: "object",
    properties: {
      category: { type: "string", enum: ["paper", "plastic", "glass", "metal", "organic", "other", "unknown"] },
      explanation: { type: "string", minLength: 1, maxLength: 400 },
      ambiguous: { type: "boolean" },
      confidence: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
    },
    required: ["category", "explanation", "ambiguous", "confidence"],
    additionalProperties: false,
  };
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Clasifica el material visible predominante en la imagen. Categorías válidas: paper, plastic, glass, metal, organic, other o unknown. Devuelve explanation en español (1-2 frases, máximo 400 caracteres, solo rasgos visibles). ambiguous=true si no hay material predominante claro. confidence solo si puedes fundamentarlo (high/medium/low), si no null. Devuelve únicamente el objeto JSON del esquema. Nunca certifiques reciclaje, peso, centros ni puntos.",
        },
        { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}` } },
      ],
    },
  ];
  const parsed = await chatCompletions(cfg, model, messages as any, schema, cfg.visionMaxTokens, undefined, fetchImpl);
  return { ...parseVisionPayload(parsed), source: "ai_suggestion", persisted: false, points: 0 };
}

export async function chatWithStructured(
  cfg: ProviderConfig,
  system: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  question: string,
  materialContext?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ answer: string }> {
  // Defense in depth: never call the provider without a configured server-side key.
  if (!cfg.apiKey) throw new AiProviderError(503, "ai_provider_unconfigured");
  const model = selectModel(cfg.chatModel, cfg.chatAllowlist, cfg.requireOpenLicense, cfg.provider);
  if (cfg.provider === "nvidia" && model !== "nvidia/nemotron-3-super-120b-a12b") throw new AiProviderError(503, "ai_provider_model_not_allowed");
  const schema = {
    type: "object",
    properties: { answer: { type: "string", minLength: 1, maxLength: 800 } },
    required: ["answer"],
    additionalProperties: false,
  };
  const grounding = materialContext && materialContext.trim()
    ? `CONTEXTO EDUCATIVO (referencia): ${materialContext.trim().replace(/\s+/g, " ").slice(0, 1500)}`
    : "CONTEXTO EDUCATIVO: no disponible.";
  const messages = [
    { role: "system", content: `La respuesta answer debe tener entre 1 y 800 caracteres. No añadas otros campos.\n${system}`.slice(0, 6000) },
    { role: "system", content: grounding },
    ...history.slice(-6).map((t) => ({ role: t.role, content: t.content.slice(0, 300) })),
    { role: "user", content: question.slice(0, 500) },
  ];
  return parseChatPayload(await chatCompletions(cfg, model, messages as any, schema, cfg.chatMaxTokens, undefined, fetchImpl));
}

export function parseChatPayload(value: unknown): { answer: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiProviderError(502, "invalid_ai_response");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || typeof row.answer !== "string") throw new AiProviderError(502, "invalid_ai_response");
  const answer = row.answer.trim().replace(/\s+/g, " ");
  if (!answer || answer.length > 800) throw new AiProviderError(502, "invalid_ai_response");
  return { answer };
}

export async function providerSelfTest(cfg: ProviderConfig, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  if (!cfg.apiKey) return false;
  let model: string;
  try {
    model = selectModel(cfg.chatModel, cfg.chatAllowlist, cfg.requireOpenLicense, cfg.provider);
  } catch {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const url = `${resolveBaseUrl(cfg)}/chat/completions`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "X-Title": "EcoPulse" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Responde solo con {\"ok\":true} en JSON estricto." }],
        max_tokens: Math.max(cfg.chatMaxTokens, 100),
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "t", strict: true, schema } },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const payload: any = await res.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return false;
    const parsed = JSON.parse(content);
    return parsed?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
