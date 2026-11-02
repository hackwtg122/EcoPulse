import assert from "node:assert/strict";
import test from "node:test";
import { parseQAAccounts, expectedReadStatus, commonReads, adminReads, verifierReads } from "./private-qa-policy.mjs";
const account = { role: "participant", testOnly: true, profilePreexists: true, userId: "user_QaTest123", email: "fixture@example.invalid", password: "mock-only-password" };
const config = accounts => JSON.stringify({ version: 1, authorized: true, accounts });
test("fixtures must explicitly authorize existing isolated test accounts", () => {
  assert.equal(parseQAAccounts(config([account])).length, 1);
  for (const raw of ["", "{", JSON.stringify({ version: 1, accounts: [account] }), config([{ ...account, testOnly: false }]), config([{ ...account, profilePreexists: false }])]) {
    assert.throws(() => parseQAAccounts(raw));
  }
});
test("reject reused identities, credentials or roles without including values in errors", () => {
  for (const other of [{ ...account, role: "admin" }, { ...account, role: "admin", userId: "user_Other123" }, { ...account, userId: "user_Other123", email: "other@example.invalid" }]) {
    assert.throws(() => parseQAAccounts(config([account, other])), /distinct/);
  }
  try { parseQAAccounts(config([{ ...account, userId: "private-invalid-id" }])); } catch (error) { assert.ok(!error.message.includes("private-invalid-id")); }
});
test("read-only allowlist covers role denials but cannot turn into a mutation client", () => {
  for (const path of commonReads) assert.equal(expectedReadStatus("participant", path), 200);
  for (const path of adminReads) { assert.equal(expectedReadStatus("participant", path), 403); assert.equal(expectedReadStatus("verifier", path), 403); assert.equal(expectedReadStatus("admin", path), 200); }
  for (const path of verifierReads) { assert.equal(expectedReadStatus("participant", path), 403); assert.equal(expectedReadStatus("verifier", path), 200); }
  for (const path of ["admin/users/user_Test/role", "deliveries/id/verify", "https://untrusted.invalid", "../me"]) assert.throws(() => expectedReadStatus("admin", path), /not_allowlisted/);
});
