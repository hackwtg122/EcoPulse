import { validScanCategory, type scanCategories } from "./pilotPolicy.ts";

export class AiClassificationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const allowedChunks = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);

// Keep only pixels and the chunks required to decode them. Text, EXIF and color-profile
// metadata are removed before the image is sent to the provider.
export function sanitizePng(input: Buffer): Buffer {
  if (input.length < 45 || input.length > 5 * 1024 * 1024 || !input.subarray(0,8).equals(pngSignature)) {
    throw new AiClassificationError(400, "invalid_image");
  }
  const chunks: Buffer[] = [pngSignature];
  let offset = 8;
  let seenHeader = false;
  let seenData = false;
  let seenEnd = false;
  while (offset + 12 <= input.length && !seenEnd) {
    const size = input.readUInt32BE(offset);
    if (size > 5 * 1024 * 1024 || offset + size + 12 > input.length) throw new AiClassificationError(400, "invalid_image");
    const type = input.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new AiClassificationError(400, "invalid_image");
    if (!seenHeader && (type !== "IHDR" || size !== 13)) throw new AiClassificationError(400, "invalid_image");
    if (type === "IHDR") {
      if (seenHeader) throw new AiClassificationError(400, "invalid_image");
      const width = input.readUInt32BE(offset + 8);
      const height = input.readUInt32BE(offset + 12);
      if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new AiClassificationError(400, "image_dimensions_out_of_range");
      seenHeader = true;
    }
    if (type === "IDAT") seenData = true;
    if (type === "IEND") {
      if (size !== 0 || !seenData) throw new AiClassificationError(400, "invalid_image");
      seenEnd = true;
    }
    if ((type.charCodeAt(0) & 32) === 0 && !allowedChunks.has(type)) throw new AiClassificationError(400, "unsupported_image_chunk");
    if (allowedChunks.has(type)) chunks.push(input.subarray(offset, offset + size + 12));
    offset += size + 12;
  }
  if (!seenEnd || offset !== input.length) throw new AiClassificationError(400, "invalid_image");
  return Buffer.concat(chunks);
}

type Category = (typeof scanCategories)[number] | "unknown";
export type AiConfidence = "high" | "medium" | "low";
export type AiSuggestion = {
  category: Category;
  explanation: string;
  ambiguous: boolean;
  /** Present only when the model can ground an assessment; null otherwise. */
  confidence: AiConfidence | null;
};

const confidenceValues = new Set<AiConfidence>(["high", "medium", "low"]);

// Strict shape: the model can never add points, persistence claims or any extra field.
export function parseAiSuggestion(value: unknown): AiSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiClassificationError(502, "invalid_ai_response");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 || !["ambiguous", "category", "confidence", "explanation"].every(key => Object.hasOwn(row, key))) {
    throw new AiClassificationError(502, "invalid_ai_response");
  }
  let category: Category;
  if (row.category === "unknown") category = "unknown";
  else if (!validScanCategory(row.category)) throw new AiClassificationError(502, "invalid_ai_category");
  else category = row.category;
  const explanation = typeof row.explanation === "string" ? row.explanation.trim().replace(/\s+/g, " ") : "";
  if (!explanation || explanation.length > 400) throw new AiClassificationError(502, "invalid_ai_response");
  if (typeof row.ambiguous !== "boolean") throw new AiClassificationError(502, "invalid_ai_response");
  let confidence: AiConfidence | null = null;
  if (row.confidence !== null) {
    if (typeof row.confidence !== "string" || !confidenceValues.has(row.confidence as AiConfidence)) {
      throw new AiClassificationError(502, "invalid_ai_response");
    }
    confidence = row.confidence as AiConfidence;
  }
  // Without a clear category there is no grounded assessment to display.
  if (category === "unknown" || row.ambiguous) return { category, explanation, ambiguous: true, confidence: null };
  return { category, explanation, ambiguous: false, confidence };
}

export type AiClassifyResult = AiSuggestion & { source: "ai_suggestion"; persisted: false; points: 0 };

// Preserved compatibility helper. The pilot route uses the configured provider
// from aiProvider.ts; this direct adapter is not called by the live API.
export async function classifyImageWithOpenAI(
  image: Buffer, apiKey: string, model: string, fetchImpl: typeof fetch = fetch,
): Promise<AiClassifyResult> {
  if (!/^[A-Za-z0-9._-]{2,100}$/.test(model) || !apiKey) throw new AiClassificationError(503, "ai_provider_unconfigured");
  const sanitized = sanitizePng(image);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, store: false, max_output_tokens: 220,
        input: [{ role: "user", content: [
          { type: "input_text", text: "Clasifica el material visible predominante en la imagen. Categorías válidas: paper, plastic, glass, metal, organic, other o unknown. Devuelve explanation con una o dos frases sencillas en español que expliquen por qué esa categoría, mencionando solo rasgos visibles. Devuelve ambiguous=true y usa unknown cuando la imagen no muestre un material predominante con claridad. Devuelve confidence solo cuando la imagen permita una evaluación fundamentada (high con material inequívoco, medium con indicios parciales); si no hay base para evaluarla, devuelve null. No certifiques reciclaje, peso, centros ni puntos." },
          { type: "input_image", image_url: `data:image/png;base64,${sanitized.toString("base64")}`, detail: "low" },
        ] }],
        text: { format: { type: "json_schema", name: "ecopulse_material", strict: true,
          schema: { type: "object", properties: {
            category: { type: "string", enum: ["paper","plastic","glass","metal","organic","other","unknown"] },
            explanation: { type: "string" }, ambiguous: { type: "boolean" },
            confidence: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
          }, required: ["category", "explanation", "ambiguous", "confidence"], additionalProperties: false } } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new AiClassificationError(502, "ai_provider_unavailable");
    const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const outputText = payload.output?.flatMap(item => item.content ?? []).find(part => part.type === "output_text")?.text;
    if (!outputText || outputText.length > 2000) throw new AiClassificationError(502, "invalid_ai_response");
    let parsed: unknown;
    try { parsed = JSON.parse(outputText); } catch { throw new AiClassificationError(502, "invalid_ai_response"); }
    return { ...parseAiSuggestion(parsed), source: "ai_suggestion", persisted: false, points: 0 };
  } catch (error) {
    if (error instanceof AiClassificationError) throw error;
    throw new AiClassificationError(502, "ai_provider_unavailable");
  } finally { clearTimeout(timer); }
}

const classifyWindowMs = 60_000;
const classifyQuotaLimit = 10;
const classifyQuota = new Map<string, { start: number; count: number }>();

export function consumeClassifyQuota(userId: string, now = Date.now()): boolean {
  if (classifyQuota.size > 1_000) {
    for (const [key, entry] of classifyQuota) if (now - entry.start >= classifyWindowMs) classifyQuota.delete(key);
  }
  const entry = classifyQuota.get(userId);
  if (!entry || now - entry.start >= classifyWindowMs) {
    classifyQuota.set(userId, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= classifyQuotaLimit;
}
