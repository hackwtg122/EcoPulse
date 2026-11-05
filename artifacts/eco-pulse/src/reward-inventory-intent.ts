import { validInventoryRestock, type RewardRestockInput } from "./reward-api.ts";

export type RestockIntent = { rewardId: string; key: string; input: RewardRestockInput };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storageKey = (userId: string) => `ecopulse:pending-restock-v1:${userId}`;
// Only public evidence and quantities are retained; never session credentials.
export function readRestockIntent(userId: string, storage: () => Store = () => sessionStorage): RestockIntent | null {
  try {
    const row = JSON.parse(storage().getItem(storageKey(userId)) ?? "null");
    if (!row || typeof row.rewardId !== "string" || !/^[0-9a-f-]{36}$/i.test(row.rewardId) || typeof row.key !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(row.key) || !validInventoryRestock(row.input)) return null;
    return { rewardId: row.rewardId, key: row.key, input: { quantity: row.input.quantity, evidenceReference: row.input.evidenceReference, availabilityConfirmed: true } };
  } catch { return null; }
}
export function saveRestockIntent(userId: string, intent: RestockIntent, storage: () => Store = () => sessionStorage) {
  try { storage().setItem(storageKey(userId), JSON.stringify(intent)); } catch { /* UI keeps the intent in memory too. */ }
}
export function clearRestockIntent(userId: string, storage: () => Store = () => sessionStorage) {
  try { storage().removeItem(storageKey(userId)); } catch { /* Storage may be blocked. */ }
}
