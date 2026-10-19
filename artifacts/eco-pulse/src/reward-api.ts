export type RewardItem = { id: string; title: string; description: string; cost: number; active?: boolean; inventoryRemaining?: number | null; fulfillmentDocumented?: boolean; validationRecorded?: boolean };
export type RedemptionItem = { id: string; rewardId: string; rewardTitle: string; cost: number; createdAt: string; fulfillmentStatus: "reserved" | "fulfilled" };
export type RewardCapabilities = { canRedeem: boolean; canManageDrafts: boolean; canFulfill: boolean; schemaReady: boolean };
export type RewardDraftInput = { title: string; description: string; cost: number };
export type PointMovement = { id: string; delta: number; kind: "delivery" | "redemption" | "adjustment"; createdAt: string };

export class RewardApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

async function parseError(response: Response): Promise<RewardApiError> {
  let code = `reward_api_${response.status}`;
  try { const body = await response.json(); if (typeof body?.error === "string") code = body.error; } catch { /* response has no JSON */ }
  return new RewardApiError(response.status, code);
}
async function call(apiUrl: string, token: string, path: string, signal: AbortSignal, options?: { method: string; body: unknown; key?: string }, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(`${apiUrl}/api/pilot/${path}`, {
    method: options?.method ?? "GET", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${token}`, ...(options ? { "Content-Type": "application/json", ...(options.key ? { "Idempotency-Key": options.key } : {}) } : {}) },
    ...(options ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RewardApiError(502, "invalid_reward_response");
  return value as Record<string, unknown>;
}
function items(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new RewardApiError(502, "invalid_reward_response");
  return value.map(object);
}
function reward(value: Record<string, unknown>): RewardItem {
  if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.description !== "string" ||
    !Number.isSafeInteger(value.cost) || (value.cost as number) < 1) throw new RewardApiError(502, "invalid_reward_response");
  return { id: value.id, title: value.title, description: value.description, cost: value.cost as number,
    ...(typeof value.active === "boolean" ? { active: value.active } : {}),
    ...(value.inventoryRemaining === null || Number.isSafeInteger(value.inventoryRemaining) ? { inventoryRemaining: value.inventoryRemaining as number | null } : {}),
    ...(typeof value.fulfillmentDocumented === "boolean" ? { fulfillmentDocumented: value.fulfillmentDocumented } : {}),
    ...(typeof value.validationRecorded === "boolean" ? { validationRecorded: value.validationRecorded } : {}) };
}
export async function loadRewards(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return items(await call(apiUrl, token, "rewards", signal, undefined, fetchImpl)).map(reward);
}
export async function loadAdminRewards(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return items(await call(apiUrl, token, "admin/rewards", signal, undefined, fetchImpl)).map(reward);
}
export async function loadRedemptions(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<RedemptionItem[]> {
  return items(await call(apiUrl, token, "redemptions", signal, undefined, fetchImpl)).map(row => {
    if (typeof row.id !== "string" || typeof row.rewardId !== "string" || typeof row.rewardTitle !== "string" ||
      !Number.isSafeInteger(row.cost) || typeof row.createdAt !== "string" ||
      (row.fulfillmentStatus !== "reserved" && row.fulfillmentStatus !== "fulfilled")) throw new RewardApiError(502, "invalid_redemption_response");
    return { id: row.id, rewardId: row.rewardId, rewardTitle: row.rewardTitle, cost: row.cost as number,
      createdAt: row.createdAt, fulfillmentStatus: row.fulfillmentStatus };
  });
}
export async function loadAdminRedemptions(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<RedemptionItem[]> {
  return items(await call(apiUrl, token, "admin/redemptions", signal, undefined, fetchImpl)).map(row => {
    if (typeof row.id !== "string" || typeof row.rewardId !== "string" || typeof row.rewardTitle !== "string" ||
      !Number.isSafeInteger(row.cost) || typeof row.createdAt !== "string" ||
      (row.fulfillmentStatus !== "reserved" && row.fulfillmentStatus !== "fulfilled")) throw new RewardApiError(502, "invalid_redemption_response");
    return { id: row.id, rewardId: row.rewardId, rewardTitle: row.rewardTitle, cost: row.cost as number,
      createdAt: row.createdAt, fulfillmentStatus: row.fulfillmentStatus };
  });
}
export async function fulfillRedemption(apiUrl: string, token: string, id: string, reference: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<{ id: string; replayed: boolean }> {
  const row = object(await call(apiUrl, token, `admin/redemptions/${encodeURIComponent(id)}/fulfill`, signal, { method: "POST", body: { reference } }, fetchImpl));
  if (typeof row.id !== "string" || typeof row.replayed !== "boolean") throw new RewardApiError(502, "invalid_fulfillment_response");
  return { id: row.id, replayed: row.replayed };
}
export async function loadRewardBalance(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  const row = object(await call(apiUrl, token, "balance", signal, undefined, fetchImpl));
  if (!Number.isSafeInteger(row.balance)) throw new RewardApiError(502, "invalid_balance_response");
  return row.balance as number;
}
export async function loadPointMovements(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<PointMovement[]> {
  return items(await call(apiUrl, token, "point-movements", signal, undefined, fetchImpl)).map(row => {
    if (typeof row.id !== "string" || !Number.isSafeInteger(row.delta) || row.delta === 0 ||
        !["delivery", "redemption", "adjustment"].includes(String(row.kind)) || typeof row.createdAt !== "string") {
      throw new RewardApiError(502, "invalid_movement_response");
    }
    return { id: row.id, delta: row.delta as number, kind: row.kind as PointMovement["kind"], createdAt: row.createdAt };
  });
}
export async function loadRewardCapabilities(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<RewardCapabilities> {
  const row = object(await call(apiUrl, token, "rewards/capabilities", signal, undefined, fetchImpl));
  if (typeof row.canRedeem !== "boolean" || typeof row.canManageDrafts !== "boolean" || typeof row.canFulfill !== "boolean" || typeof row.schemaReady !== "boolean") throw new RewardApiError(502, "invalid_reward_capabilities");
  return { canRedeem: row.canRedeem, canManageDrafts: row.canManageDrafts, canFulfill: row.canFulfill, schemaReady: row.schemaReady };
}
export async function createRewardDraft(apiUrl: string, token: string, input: RewardDraftInput, key: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return reward(object(await call(apiUrl, token, "admin/rewards", signal, { method: "POST", body: input, key }, fetchImpl)));
}
export async function updateRewardDraft(apiUrl: string, token: string, id: string, expected: RewardDraftInput, next: RewardDraftInput, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return reward(object(await call(apiUrl, token, `admin/rewards/${encodeURIComponent(id)}`, signal, { method: "PATCH", body: { expected, next } }, fetchImpl)));
}
export async function redeemReward(apiUrl: string, token: string, rewardId: string, key: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return object(await call(apiUrl, token, "redemptions", signal, { method: "POST", body: { rewardId }, key }, fetchImpl));
}
