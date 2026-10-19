export type GuideTurn = { role: "user" | "assistant"; content: string };

export class GuideApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

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
    const code = typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error : "guide_unavailable";
    throw new GuideApiError(response.status, code);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body) || (body as { source?: unknown }).source !== "ai" ||
      typeof (body as { answer?: unknown }).answer !== "string" || !(body as { answer: string }).answer.trim()) {
    throw new GuideApiError(502, "invalid_guide_response");
  }
  return (body as { answer: string }).answer.trim();
}
