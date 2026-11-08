export type RewardItem = { id: string; title: string; description: string; cost: number; active?: boolean; inventoryRemaining?: number | null; fulfillmentDocumented?: boolean; validationRecorded?: boolean; draftRecoveryAvailable?: boolean; operationallyValidated?: boolean; digitalAssetKey?: string | null; imageUrl?: string | null };
export type RedemptionItem = { id: string; rewardId: string; rewardTitle: string; cost: number; createdAt: string; fulfillmentStatus: "reserved" | "fulfilled"; digitalAsset?: "nature-v1" | "badge-v1" | "guide-v1" | null; digitalFulfillmentReference?: string | null };
export type RewardCapabilities = { canRedeem: boolean; canManageDrafts: boolean; canPublish: boolean; canFulfill: boolean; schemaReady: boolean; canRestock: boolean; inventorySchemaReady: boolean; canRecoverDraft: boolean };
export type RewardRestockInput = { quantity: number; evidenceReference: string; availabilityConfirmed: true };
export type InventoryMovement = { id: string; rewardId: string; administratorId: string; quantity: number; inventoryBefore: number; inventoryAfter: number; evidenceReference: string; createdAt: string };
export type PhysicalRewardPhotoInput = { imageUrl: string; sourceUrl: string; photoConfirmed: true };
export async function savePhysicalRewardPhoto(apiUrl: string, token: string, id: string, input: PhysicalRewardPhotoInput, signal: AbortSignal, fetchImpl?: typeof fetch) {
  const result = object(await call(apiUrl, token, `admin/rewards/${id}/photo`, signal, { method: "PUT", body: input }, fetchImpl));
  if (result.rewardId !== id || result.imageUrl !== input.imageUrl || result.sourceUrl !== input.sourceUrl ||
    typeof result.confirmedAt !== "string") throw new RewardApiError(502, "invalid_reward_photo_response");
  return result;
}
export type RewardDraftInput = { title: string; description: string; cost: number };
export async function withdrawReward(apiUrl:string,token:string,id:string,signal:AbortSignal) {
  const row=object(await call(apiUrl,token,`admin/rewards/${encodeURIComponent(id)}/withdraw`,signal,{method:"POST",body:{}}));
  if(row.rewardId!==id || typeof row.replayed!=="boolean") throw new RewardApiError(502,"invalid_withdrawal_response");
  return row;
}
export type RewardPublicationInput = { expected: RewardDraftInput; inventoryRemaining: number } & ({ fulfillmentReference: string } | { digitalAssetKey: string; availabilityConfirmed: true });
export type DigitalRewardAsset = { key: string; rewardTitle: string; title: string; filename: string; contentType: string; bytes: number; sha256: string; evidenceReference: string; fulfillmentReference: string };
export async function loadDigitalRewardAssets(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<DigitalRewardAsset[]> {
  return items(await call(apiUrl, token, "admin/digital-assets", signal, undefined, fetchImpl)).map(row => {
    if (typeof row.key !== "string" || typeof row.rewardTitle !== "string" || typeof row.title !== "string" || typeof row.filename !== "string" ||
      !["application/pdf", "image/svg+xml"].includes(String(row.contentType)) || !Number.isSafeInteger(row.bytes) || (row.bytes as number) <= 0 ||
      typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256) || typeof row.evidenceReference !== "string" ||
      typeof row.fulfillmentReference !== "string" || row.fulfillmentReference !== "digital:ecopulse/" + row.key) throw new RewardApiError(502, "invalid_digital_asset_response");
    return row as DigitalRewardAsset;
  });
}
export type PointMovement = { id: string; delta: number; kind: "delivery" | "redemption" | "adjustment" | "education"; createdAt: string };
export type FulfilledRedemption = { id: string; rewardId: string; rewardTitle: string; cost: number; createdAt: string; fulfilledAt: string; fulfillmentReference: string };
export type FulfillmentHistory = { items: FulfilledRedemption[]; nextCursor: string | null };

export function hasRewardInventory(item: RewardItem): boolean {
  return item.active === true && Number.isSafeInteger(item.inventoryRemaining) && (item.inventoryRemaining as number) > 0;
}
export function canEditRewardDraft(item: RewardItem): boolean {
  return item.active === false && item.validationRecorded !== true && item.fulfillmentDocumented !== true;
}
export function canRestockReward(item: RewardItem): boolean {
  return item.operationallyValidated === true && item.validationRecorded === true && item.fulfillmentDocumented === true &&
    Number.isSafeInteger(item.inventoryRemaining) && (item.inventoryRemaining as number) >= 0 && (item.inventoryRemaining as number) <= 100000 &&
    (item.active === true || item.inventoryRemaining === 0);
}

export function canRedeemReward(item: RewardItem, canRedeem: boolean, balance: number): boolean {
  return canRedeem && hasRewardInventory(item) && Number.isSafeInteger(item.cost) && item.cost > 0 &&
    Number.isSafeInteger(balance) && balance >= item.cost;
}

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
    ...(typeof value.validationRecorded === "boolean" ? { validationRecorded: value.validationRecorded } : {}),
    ...(typeof value.draftRecoveryAvailable === "boolean" ? { draftRecoveryAvailable: value.draftRecoveryAvailable } : {}),
    ...(typeof value.operationallyValidated === "boolean" ? { operationallyValidated: value.operationallyValidated } : {}),
    ...(typeof value.digitalAssetKey === "string" ? { digitalAssetKey: value.digitalAssetKey } : {}),
    ...(typeof value.imageUrl === "string" && value.imageUrl.startsWith("https://") ? { imageUrl: value.imageUrl } : {}) };
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
      createdAt: row.createdAt, fulfillmentStatus: row.fulfillmentStatus,
      digitalAsset: row.fulfillmentStatus === "fulfilled" && (row.digitalAsset === "nature-v1" || row.digitalAsset === "badge-v1" || row.digitalAsset === "guide-v1") ? row.digitalAsset : null };
  });
}
export async function loadAdminRedemptions(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<RedemptionItem[]> {
  return items(await call(apiUrl, token, "admin/redemptions", signal, undefined, fetchImpl)).map(row => {
    if (typeof row.id !== "string" || typeof row.rewardId !== "string" || typeof row.rewardTitle !== "string" ||
      !Number.isSafeInteger(row.cost) || typeof row.createdAt !== "string" ||
      (row.fulfillmentStatus !== "reserved" && row.fulfillmentStatus !== "fulfilled")) throw new RewardApiError(502, "invalid_redemption_response");
    return { id: row.id, rewardId: row.rewardId, rewardTitle: row.rewardTitle, cost: row.cost as number,
      createdAt: row.createdAt, fulfillmentStatus: row.fulfillmentStatus,
      digitalFulfillmentReference: typeof row.digitalFulfillmentReference === "string" && /^digital:ecopulse\/(guide-v1|badge-v1|nature-v1)$/.test(row.digitalFulfillmentReference) ? row.digitalFulfillmentReference : null };
  });
}
export async function fulfillRedemption(apiUrl: string, token: string, id: string, reference: string, signal: AbortSignal, fetchImpl?: typeof fetch, pickupCode?: string): Promise<{ id: string; replayed: boolean }> {
  const row = object(await call(apiUrl, token, `admin/redemptions/${encodeURIComponent(id)}/fulfill`, signal, { method: "POST", body: { reference, ...(pickupCode === undefined ? {} : { pickupCode }) } }, fetchImpl));
  if (row.id !== id || typeof row.replayed !== "boolean") throw new RewardApiError(502, "invalid_fulfillment_response");
  return { id: row.id, replayed: row.replayed };
}

export async function loadAdminFulfillmentHistory(apiUrl: string, token: string, cursor: string | null, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<FulfillmentHistory> {
  const cursorPattern = /^[A-Za-z0-9_-]{8,1024}$/;
  if (cursor !== null && !cursorPattern.test(cursor)) throw new RewardApiError(400, "invalid_pagination");
  const path = `admin/redemptions/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const page = object(await call(apiUrl, token, path, signal, undefined, fetchImpl));
  if (!Array.isArray(page.items) || page.items.length > 20 || (page.nextCursor !== null &&
    (typeof page.nextCursor !== "string" || !cursorPattern.test(page.nextCursor)))) throw new RewardApiError(502, "invalid_fulfillment_history");
  const history = items(page.items).map(row => {
    if (typeof row.id !== "string" || typeof row.rewardId !== "string" || typeof row.rewardTitle !== "string" ||
      !Number.isSafeInteger(row.cost) || (row.cost as number) < 1 ||
      typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
      typeof row.fulfilledAt !== "string" || !Number.isFinite(Date.parse(row.fulfilledAt)) ||
      typeof row.fulfillmentReference !== "string" || !/^[A-Za-z0-9_:/.-]{10,120}$/.test(row.fulfillmentReference)) {
      throw new RewardApiError(502, "invalid_fulfillment_history");
    }
    return { id: row.id, rewardId: row.rewardId, rewardTitle: row.rewardTitle, cost: row.cost as number,
      createdAt: row.createdAt, fulfilledAt: row.fulfilledAt, fulfillmentReference: row.fulfillmentReference };
  });
  return { items: history, nextCursor: page.nextCursor as string | null };
}
export async function loadRewardBalance(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  const row = object(await call(apiUrl, token, "balance", signal, undefined, fetchImpl));
  if (!Number.isSafeInteger(row.balance)) throw new RewardApiError(502, "invalid_balance_response");
  return row.balance as number;
}
export async function downloadRedemption(apiUrl: string, token: string, id: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  const response = await fetchImpl(`${apiUrl}/api/pilot/redemptions/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
  if (!response.ok) throw await parseError(response);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "image/svg+xml" && contentType !== "application/pdf") throw new RewardApiError(502, "invalid_download_response");
  return response.blob();
}
export async function loadPointMovements(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<PointMovement[]> {
  return items(await call(apiUrl, token, "point-movements", signal, undefined, fetchImpl)).map(row => {
    if (typeof row.id !== "string" || !Number.isSafeInteger(row.delta) || row.delta === 0 ||
        !["delivery", "redemption", "adjustment", "education"].includes(String(row.kind)) || typeof row.createdAt !== "string") {
      throw new RewardApiError(502, "invalid_movement_response");
    }
    return { id: row.id, delta: row.delta as number, kind: row.kind as PointMovement["kind"], createdAt: row.createdAt };
  });
}
export async function loadRewardCapabilities(apiUrl: string, token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<RewardCapabilities> {
  const row = object(await call(apiUrl, token, "rewards/capabilities", signal, undefined, fetchImpl));
  if (typeof row.canRedeem !== "boolean" || typeof row.canManageDrafts !== "boolean" || typeof row.canFulfill !== "boolean" || typeof row.schemaReady !== "boolean") throw new RewardApiError(502, "invalid_reward_capabilities");
  if (row.canPublish !== undefined && typeof row.canPublish !== "boolean") throw new RewardApiError(502, "invalid_reward_capabilities");
  for (const key of ["canRestock", "inventorySchemaReady", "canRecoverDraft"]) if (row[key] !== undefined && typeof row[key] !== "boolean") throw new RewardApiError(502, "invalid_reward_capabilities");
  return { canRedeem: row.canRedeem, canManageDrafts: row.canManageDrafts, canPublish: row.canPublish === true, canFulfill: row.canFulfill, schemaReady: row.schemaReady,
    canRestock: row.canRestock === true, inventorySchemaReady: row.inventorySchemaReady === true, canRecoverDraft: row.canRecoverDraft === true };
}

export async function recoverRewardDraft(apiUrl: string, token: string, rewardId: string, key: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  const row = object(await call(apiUrl, token, `admin/rewards/${encodeURIComponent(rewardId)}/recover-draft`, signal, { method: "POST", body: {}, key }, fetchImpl));
  if (row.rewardId !== rewardId || typeof row.replayed !== "boolean") throw new RewardApiError(502, "invalid_reward_recovery_response");
  return { rewardId, replayed: row.replayed };
}

export function validInventoryRestock(value: unknown): value is RewardRestockInput {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.availabilityConfirmed !== true || !Number.isSafeInteger(row.quantity) || (row.quantity as number) < 1 || (row.quantity as number) > 100000 ||
    typeof row.evidenceReference !== "string" || row.evidenceReference.length < 10 || row.evidenceReference.length > 500) return false;
  try {
    const url = new URL(row.evidenceReference);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && url.hostname.includes(".") &&
      !url.hostname.endsWith(".local") && !/^\d+(?:\.\d+){3}$/.test(url.hostname) && !url.hostname.startsWith("[") && url.href === row.evidenceReference;
  } catch { return false; }
}
function inventoryMovement(value: unknown): InventoryMovement {
  const row = object(value), uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof row.id !== "string" || !uuid.test(row.id) || typeof row.rewardId !== "string" || !uuid.test(row.rewardId) ||
    typeof row.administratorId !== "string" || !/^user_[A-Za-z0-9]{3,64}$/.test(row.administratorId) ||
    !validInventoryRestock({ quantity: row.quantity, evidenceReference: row.evidenceReference, availabilityConfirmed: true }) ||
    !Number.isSafeInteger(row.inventoryBefore) || (row.inventoryBefore as number) < 0 ||
    !Number.isSafeInteger(row.inventoryAfter) || (row.inventoryAfter as number) > 100000 ||
    row.inventoryAfter !== (row.inventoryBefore as number) + (row.quantity as number) ||
    typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw new RewardApiError(502, "invalid_inventory_response");
  return { id: row.id, rewardId: row.rewardId, administratorId: row.administratorId, quantity: row.quantity as number,
    inventoryBefore: row.inventoryBefore as number, inventoryAfter: row.inventoryAfter as number, evidenceReference: row.evidenceReference as string, createdAt: row.createdAt };
}
export async function restockRewardInventory(apiUrl: string, token: string, rewardId: string, key: string, input: RewardRestockInput, signal: AbortSignal, fetchImpl?: typeof fetch) {
  if (!validInventoryRestock(input) || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new RewardApiError(400, "invalid_inventory_request");
  const row = object(await call(apiUrl, token, `admin/rewards/${encodeURIComponent(rewardId)}/restock`, signal, { method: "POST", body: input, key }, fetchImpl));
  const movement = inventoryMovement(row.movement);
  if (typeof row.replayed !== "boolean" || movement.rewardId !== rewardId || movement.quantity !== input.quantity || movement.evidenceReference !== input.evidenceReference) throw new RewardApiError(502, "invalid_inventory_response");
  return { movement, replayed: row.replayed };
}
export async function loadRewardInventoryHistory(apiUrl: string, token: string, rewardId: string, cursor: string | null, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<{ items: InventoryMovement[]; nextCursor: string | null }> {
  const pattern = /^[A-Za-z0-9_-]{8,1024}$/;
  if (cursor !== null && !pattern.test(cursor)) throw new RewardApiError(400, "invalid_pagination");
  const page = object(await call(apiUrl, token, `admin/rewards/${encodeURIComponent(rewardId)}/inventory-movements?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal, undefined, fetchImpl));
  if (!Array.isArray(page.items) || page.items.length > 20 || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !pattern.test(page.nextCursor)))) throw new RewardApiError(502, "invalid_inventory_response");
  const rows = page.items.map(inventoryMovement);
  if (rows.some(row => row.rewardId !== rewardId)) throw new RewardApiError(502, "invalid_inventory_response");
  return { items: rows, nextCursor: page.nextCursor as string | null };
}
export async function createRewardDraft(apiUrl: string, token: string, input: RewardDraftInput, key: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return reward(object(await call(apiUrl, token, "admin/rewards", signal, { method: "POST", body: input, key }, fetchImpl)));
}
export async function updateRewardDraft(apiUrl: string, token: string, id: string, expected: RewardDraftInput, next: RewardDraftInput, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return reward(object(await call(apiUrl, token, `admin/rewards/${encodeURIComponent(id)}`, signal, { method: "PATCH", body: { expected, next } }, fetchImpl)));
}
export async function publishRewardDraft(apiUrl: string, token: string, id: string, input: RewardPublicationInput, signal: AbortSignal, fetchImpl?: typeof fetch) {
  const result = reward(object(await call(apiUrl, token, `admin/rewards/${encodeURIComponent(id)}/publish`, signal, { method: "POST", body: input }, fetchImpl)));
  if (result.id !== id || result.active !== true || result.validationRecorded !== true || result.fulfillmentDocumented !== true || !Number.isSafeInteger(result.inventoryRemaining) || (result.inventoryRemaining as number) < 1) throw new RewardApiError(502, "invalid_reward_publication_response");
  return result;
}
export async function redeemReward(apiUrl: string, token: string, rewardId: string, key: string, signal: AbortSignal, fetchImpl?: typeof fetch) {
  return object(await call(apiUrl, token, "redemptions", signal, { method: "POST", body: { rewardId }, key }, fetchImpl));
}
