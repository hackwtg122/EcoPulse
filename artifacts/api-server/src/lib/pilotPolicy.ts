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

export function validReceiptCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
