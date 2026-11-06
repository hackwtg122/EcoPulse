const keyPattern = /^[A-Za-z0-9_-]{8,128}$/;
const storageKey = (userId: string) => "ecopulse-platform-activation:" + userId;
export function activationIntent(userId: string, previous: { userId: string; key: string } | null,
  storage: Pick<Storage, "getItem" | "setItem"> | null, newKey: () => string) {
  if (previous?.userId === userId && keyPattern.test(previous.key)) return previous;
  let key: string | null = null;
  try { key = storage?.getItem(storageKey(userId)) ?? null; } catch { /* Memory still supports safe retries. */ }
  if (!key || !keyPattern.test(key)) key = newKey();
  try { storage?.setItem(storageKey(userId), key); } catch { /* Keep the in-memory key. */ }
  return { userId, key };
}
export function clearActivationIntent(userId: string, storage: Pick<Storage, "removeItem"> | null) {
  try { storage?.removeItem(storageKey(userId)); } catch { /* Replaying a completed event remains safe. */ }
}
