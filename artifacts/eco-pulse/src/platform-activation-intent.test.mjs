import assert from "node:assert/strict";
import test from "node:test";
import { activationIntent, clearActivationIntent } from "./platform-activation-intent.ts";
test("activation retries and reloads retain the same account-scoped intent", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const first = activationIntent("admin", null, storage, () => "intent_123");
  assert.deepEqual(activationIntent("admin", null, storage, () => "unexpected"), first);
  assert.notEqual(activationIntent("another", first, storage, () => "intent_456").key, first.key);
  clearActivationIntent("admin", storage);
  assert.equal(activationIntent("admin", null, storage, () => "intent_789").key, "intent_789");
});
test("blocked storage preserves an in-memory retry without changing the intent", () => {
  const storage = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  const first = activationIntent("admin", null, storage, () => "intent_123");
  assert.equal(activationIntent("admin", first, storage, () => "unexpected"), first);
  assert.doesNotThrow(() => clearActivationIntent("admin", storage));
});
