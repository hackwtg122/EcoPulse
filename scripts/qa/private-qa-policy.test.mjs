import assert from "node:assert/strict";
import test from "node:test";
import { parseQAAccounts, expectedReadStatus, commonReads, adminReads, verifierReads, safePrivateDiagnostic, PrivateQAError } from "./private-qa-policy.mjs";
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

test("fixture diagnostics identify the exact field and ordinal, never its value", () => {
  for (const [field, value, code] of [
    ["role", "PRIVATE_SECRET_VALUE", "qa_account_role_invalid"],
    ["testOnly", false, "qa_account_test_only_required"],
    ["profilePreexists", false, "qa_account_profile_attestation_required"],
    ["userId", "PRIVATE_SECRET_VALUE", "qa_account_user_id_invalid"],
    ["email", "PRIVATE_SECRET_VALUE", "qa_account_email_invalid"],
    ["password", "short", "qa_account_password_invalid"],
  ]) {
    try { parseQAAccounts(config([{ ...account, [field]: value }])); assert.fail("expected rejection"); }
    catch (error) {
      const diagnostic = safePrivateDiagnostic(error);
      assert.deepEqual(diagnostic, { reason: code, field, accountIndex: 0 });
      assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE_SECRET_VALUE"));
    }
  }
});
test("JSON syntax, version and explicit consent failures remain distinct", () => {
  for (const [raw, code, field] of [
    ["{ PRIVATE_SECRET_VALUE", "qa_fixture_json_invalid", "root"],
    [JSON.stringify({ version: "1", authorized: true, accounts: [account] }), "qa_fixture_version_invalid", "version"],
    [JSON.stringify({ version: 1, authorized: "true", accounts: [account] }), "explicit_test_fixture_authorization_required", "authorized"],
  ]) {
    try { parseQAAccounts(raw); assert.fail("expected rejection"); }
    catch (error) { assert.deepEqual(safePrivateDiagnostic(error), { reason: code, field }); }
  }
});
test("harmless Markdown/BOM/uppercase roles normalize without changing credentials or weakening attestations", () => {
  const raw = '\uFEFF```json\n' + config([{ ...account, role: " PARTICIPANT ", password: "  mock-password  " }]) + '\n```';
  const result = parseQAAccounts(raw)[0];
  assert.equal(result.role, "participant");
  assert.equal(result.password, "  mock-password  ");
  assert.throws(() => parseQAAccounts(config([{ ...account, testOnly: undefined }])));
});
test("instructional placeholders and arbitrary exceptions cannot masquerade as actual account validation", () => {
  assert.throws(() => parseQAAccounts(config([{ ...account, userId: "user_TestParticipant001" }])), { code: "qa_account_placeholder_value", field: "userId" });
  assert.deepEqual(safePrivateDiagnostic(new Error("a_private_password_or_response")), { reason: "private_setup_unexpected_error" });
  assert.deepEqual(safePrivateDiagnostic(Object.assign(new Error("PRODUCTION_QA_ACCOUNTS_secret_missing"), { code: "PRODUCTION_QA_ACCOUNTS_secret_missing" })), { reason: "private_setup_unexpected_error" });
  assert.deepEqual(safePrivateDiagnostic(new PrivateQAError("not_allowlisted", "secret_field", 100)), { reason: "private_setup_unexpected_error" });
});
