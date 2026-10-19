import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessVerifierQueue,
  canVerifyDelivery,
  hasOnlyFields,
  verificationActionsEnabled,
} from "./pilotPolicy.ts";

test("client payloads cannot select or replace the authenticated user", () => {
  assert.equal(hasOnlyFields({ category: "paper" }, ["category"]), true);
  assert.equal(hasOnlyFields({ category: "paper", userId: "other" }, ["category"]), false);
  assert.equal(hasOnlyFields({ category: "paper", clerkUserId: "other" }, ["category"]), false);
  assert.equal(hasOnlyFields({ category: "paper", role: "admin" }, ["category"]), false);
  assert.equal(hasOnlyFields({}, []), true);
  assert.equal(hasOnlyFields({ userId: "other" }, []), false);
  assert.equal(hasOnlyFields({ status: "approved" }, []), false);
  assert.equal(hasOnlyFields(null, []), false);
  assert.equal(hasOnlyFields([], []), false);
});

test("the pending queue is restricted to verifier and admin roles", () => {
  assert.equal(canAccessVerifierQueue("participant"), false);
  assert.equal(canAccessVerifierQueue(undefined), false);
  assert.equal(canAccessVerifierQueue("verifier"), true);
  assert.equal(canAccessVerifierQueue("admin"), true);
});

test("verification requires an authorized role and a different owner", () => {
  assert.equal(canVerifyDelivery("participant", "user-a", "user-b"), false);
  assert.equal(canVerifyDelivery("verifier", "user-a", "user-a"), false);
  assert.equal(canVerifyDelivery("admin", "user-a", "user-a"), false);
  assert.equal(canVerifyDelivery("verifier", "user-a", "user-b"), true);
  assert.equal(canVerifyDelivery("admin", "user-a", "user-b"), true);
});

test("verification mutations stay disabled unless explicitly enabled", () => {
  assert.equal(verificationActionsEnabled(undefined), false);
  assert.equal(verificationActionsEnabled("false"), false);
  assert.equal(verificationActionsEnabled("TRUE"), false);
  assert.equal(verificationActionsEnabled("true"), true);
});
