import { createHash } from "node:crypto";

export const scanCategories = ["paper", "plastic", "glass", "metal", "organic", "other"] as const;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validScanCategory(value: unknown): value is (typeof scanCategories)[number] {
  return typeof value === "string" && (scanCategories as readonly string[]).includes(value);
}

export function pointsForVerifiedGrams(grams: number, pointsPerKg: number): number {
  if (!Number.isSafeInteger(grams) || grams < 1 || grams > 100_000) {
    throw new RangeError("verified grams must be between 1 and 100000");
  }
  if (!Number.isSafeInteger(pointsPerKg) || pointsPerKg < 1 || pointsPerKg > 1000) {
    throw new RangeError("points per kg must be between 1 and 1000");
  }
  return Math.floor((grams * pointsPerKg) / 1000);
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function idForIdempotency(namespace: "scan" | "delivery", userId: string, idempotencyKey: string): string {
  const bytes = createHash("sha256")
    .update(`ecopulse:${namespace}\0`)
    .update(userId)
    .update("\0")
    .update(idempotencyKey)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function scanIdForIdempotency(userId: string, idempotencyKey: string): string {
  return idForIdempotency("scan", userId, idempotencyKey);
}

export function deliveryIdForIdempotency(userId: string, idempotencyKey: string): string {
  return idForIdempotency("delivery", userId, idempotencyKey);
}

export type DeliveryCursor = { createdAt: Date; id: string };
export type DeliveryCursorResult =
  | { ok: true; value: DeliveryCursor | null }
  | { ok: false };

export function encodeDeliveryCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), "utf8").toString("base64url");
}

export function parseDeliveryCursor(value: unknown): DeliveryCursorResult {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return { ok: false };
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || !uuidPattern.test(decoded[1])) {
      return { ok: false };
    }
    const createdAt = new Date(decoded[0]);
    if (Number.isNaN(createdAt.valueOf()) || createdAt.toISOString() !== decoded[0]) return { ok: false };
    return { ok: true, value: { createdAt, id: decoded[1] } };
  } catch {
    return { ok: false };
  }
}

export function parseDeliveryPageLimit(value: unknown): number | null {
  if (value === undefined) return 20;
  if (typeof value !== "string" || !/^[1-9][0-9]?$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= 50 ? limit : null;
}

export const rejectionReasonCodes = ["material_not_received", "contaminated", "material_mismatch", "other"] as const;
export type RejectionReasonCode = (typeof rejectionReasonCodes)[number];

export function validRejectionReason(value: unknown): value is RejectionReasonCode {
  return typeof value === "string" && (rejectionReasonCodes as readonly string[]).includes(value);
}

export type PointsPolicy = { pointsPerKg: number; maxPointsPerDelivery: number };
export function parsePointsPolicy(rate: unknown, cap: unknown): PointsPolicy | null {
  if (typeof rate !== "string" || !/^[1-9][0-9]{0,3}$/.test(rate)) return null;
  if (typeof cap !== "string" || !/^[1-9][0-9]{0,5}$/.test(cap)) return null;
  const pointsPerKg = Number(rate);
  const maxPointsPerDelivery = Number(cap);
  if (pointsPerKg > 1000 || maxPointsPerDelivery > 100_000) return null;
  return { pointsPerKg, maxPointsPerDelivery };
}

export function validReceiptCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function hasOnlyFields(value: unknown, allowedFields: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).every((field) => allowedFields.includes(field));
}

export function canAccessVerifierQueue(role: unknown): boolean {
  return role === "verifier" || role === "admin";
}

export function verificationActionsEnabled(value: unknown): boolean {
  return value === "true";
}

export function canVerifyDelivery(role: unknown, actorId: string, ownerId: string): boolean {
  return canAccessVerifierQueue(role) && actorId !== ownerId;
}
