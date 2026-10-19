export type GuideTurn = { role: "user" | "assistant"; content: string };

export function createGuideRequestGate() {
  let active = false;
  return {
    enter(): boolean { if (active) return false; active = true; return true; },
    leave(): void { active = false; },
  };
}

export class GuideApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number;
  constructor(status: number, code: string, retryAfterSeconds = 0) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const guideQuotaMessages: Record<string, string> = {
  ai_rate_limited: "El proveedor de IA está limitando las solicitudes en este momento.",
  ai_quota_minute: "Hiciste varias preguntas seguidas. Espera un momento antes de reintentar.",
  ai_quota_daily: "Alcanzaste tu límite diario de IA. El cupo se renueva a las 00:00 UTC.",
  ai_quota_global: "Se agotó el cupo diario de IA de la plataforma. Se renueva a las 00:00 UTC.",
  ai_quota_busy: "EcoGuía está ocupada en este momento. Reintenta en unos segundos.",
};

export async function loadGuideCapabilities(apiUrl: string, token: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`${apiUrl}/api/pilot/guide/capabilities`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
  });
  if (!response.ok) throw new GuideApiError(response.status, "guide_unavailable");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body) || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
    throw new GuideApiError(502, "invalid_guide_capabilities");
  }
  return (body as { enabled: boolean }).enabled;
}

export async function askGuide(apiUrl: string, token: string, question: string, history: GuideTurn[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const cleanQuestion = question.trim();
  if (!cleanQuestion || cleanQuestion.length > 500) throw new GuideApiError(400, "invalid_guide_question");
  const boundedHistory = history.slice(-6).map(turn => ({ role: turn.role, content: turn.content.trim().slice(0, 300) }));
  const response = await fetcher(`${apiUrl}/api/pilot/guide/ask`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-AI-Consent": "true" },
    body: JSON.stringify({ question: cleanQuestion, history: boundedHistory }), cache: "no-store", signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const row = typeof body === "object" && body !== null && !Array.isArray(body) ? body as { error?: unknown; retryAfterSeconds?: unknown } : null;
    const code = typeof row?.error === "string" ? row.error : "guide_unavailable";
    const retryAfterSeconds = typeof row?.retryAfterSeconds === "number" && Number.isFinite(row.retryAfterSeconds) && row.retryAfterSeconds > 0
      ? Math.ceil(row.retryAfterSeconds) : 0;
    throw new GuideApiError(response.status, code, retryAfterSeconds);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body) || (body as { source?: unknown }).source !== "ai" ||
      typeof (body as { answer?: unknown }).answer !== "string" || !(body as { answer: string }).answer.trim()) {
    throw new GuideApiError(502, "invalid_guide_response");
  }
  return (body as { answer: string }).answer.trim();
}
