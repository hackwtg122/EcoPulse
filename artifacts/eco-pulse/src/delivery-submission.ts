import type { DetailedDeliveryRequest } from "./pilot-api.ts";

type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Attempt = { userId: string; key: string; payload: DetailedDeliveryRequest | null };
const keyPattern = /^[A-Za-z0-9_-]{8,128}$/;
const storageKey = (userId: string) => `ecopulse:pending-delivery-operation-v2:${userId}`;

// An uncertain POST must keep BOTH the key and its original payload, even
// without browser storage. Browser storage contains no session credentials.
export class DeliverySubmission {
  current: Attempt | null = null;
  private storage: StorageAccess;
  private newKey: () => string;
  constructor(storage: StorageAccess, newKey = () => `delivery_${crypto.randomUUID().replaceAll("-", "")}`) {
    this.storage = storage;
    this.newKey = newKey;
  }

  begin(userId: string, payload: DetailedDeliveryRequest | null): Attempt {
    if (this.current?.userId === userId) return this.current;
    const signature = JSON.stringify(payload ?? {});
    let key: string | undefined;
    try {
      const stored = JSON.parse(this.storage().getItem(storageKey(userId)) ?? "null");
      if (stored?.signature === signature && typeof stored.key === "string" && keyPattern.test(stored.key)) key = stored.key;
    } catch { /* Use memory when storage is blocked or corrupt. */ }
    key ??= this.newKey();
    this.current = { userId, key, payload: structuredClone(payload) };
    try { this.storage().setItem(storageKey(userId), JSON.stringify({ key, signature })); } catch { /* Memory remains authoritative until confirmation. */ }
    return this.current;
  }

  complete() {
    if (this.current) {
      try { this.storage().removeItem(storageKey(this.current.userId)); } catch { /* No secrets are stored. */ }
    }
    this.current = null;
  }

  reset() { this.current = null; }
}

// These errors are returned before a write, or after a transaction rollback.
// Unknown failures must not silently permit a new request with another key.
export function deliveryRequestRejected(status: number, code: string): boolean {
  return (status === 400 && code !== "idempotency_key_reused") || (status === 409 && [
    "delivery_slot_unavailable", "delivery_details_conflict", "material_category_unavailable",
    "delivery_point_unavailable", "delivery_slot_required", "delivery_slot_not_applicable",
  ].includes(code));
}
