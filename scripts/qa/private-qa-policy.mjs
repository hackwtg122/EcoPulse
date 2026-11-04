export const qaRoles = ["participant", "verifier", "admin"];
export const commonReads = ["me", "balance", "point-movements", "favorites", "progress", "scans", "scans/ai-capabilities", "guide/capabilities", "guide/conversations", "delivery-points", "evaluation-points", "delivery-options", "deliveries", "rewards/capabilities", "rewards", "redemptions"];
export const adminReads = ["admin/catalog", "admin/stats", "admin/rewards", "admin/redemptions", "admin/users"];
export const verifierReads = ["verifier/capabilities", "verifier/deliveries"];
export const privatePages = ["/dashboard", "/profile", "/security", "/map", "/scan", "/chat", "/deliveries", "/progress", "/rewards"];

const diagnosticCodes = new Set([
  "PRODUCTION_QA_ACCOUNTS_secret_missing", "qa_fixture_json_invalid", "qa_fixture_root_invalid", "qa_fixture_version_invalid",
  "explicit_test_fixture_authorization_required", "qa_fixture_accounts_invalid", "qa_account_fixture_invalid", "qa_account_test_only_required",
  "qa_account_profile_attestation_required", "qa_account_role_invalid", "qa_account_user_id_invalid", "qa_account_email_invalid",
  "qa_account_password_invalid", "qa_account_placeholder_value", "qa_accounts_must_be_distinct_by_identity_and_role",
  "official_main_remote_runner_required", "explicit_private_run_authorization_required", "expected_commit_required",
  "private_run_deployed_commit_mismatch", "private_run_frontend_commit_unverified", "private_run_frontend_commit_mismatch",
  "private_run_remote_identity_unavailable", "remote_browser_dependencies_required", "remote_browser_module_unavailable", "remote_browser_launch_failed",
  "qa_fixture_identity_mismatch", "qa_application_role_mismatch", "qa_api_session_rejected", "qa_api_session_token_unavailable", "qa_profile_or_api_unavailable",
  "qa_clerk_account_not_found", "qa_clerk_password_rejected", "qa_clerk_captcha_required", "qa_login_interactive_factor_or_incomplete",
]);
const diagnosticFields = new Set(["root", "version", "authorized", "accounts", "role", "testOnly", "profilePreexists", "userId", "email", "password"]);
export class PrivateQAError extends Error {
  constructor(code, field, accountIndex) {
    super(diagnosticCodes.has(code) ? code : "private_setup_unexpected_error");
    this.code = this.message;
    if (diagnosticFields.has(field)) this.field = field;
    if (Number.isInteger(accountIndex) && accountIndex >= 0 && accountIndex < 3) this.accountIndex = accountIndex;
  }
}
export function safePrivateDiagnostic(error) {
  // Never log an arbitrary exception message: even a snake_case message could
  // be a secret. Codes/fields must come from our fixed allowlists and class.
  if (!(error instanceof PrivateQAError) || !diagnosticCodes.has(error.code)) return { reason: "private_setup_unexpected_error" };
  return { reason: error.code, ...(diagnosticFields.has(error.field) ? { field: error.field } : {}),
    ...(Number.isInteger(error.accountIndex) && error.accountIndex >= 0 && error.accountIndex < 3 ? { accountIndex: error.accountIndex } : {}) };
}

export function parseQAAccounts(raw) {
  if (!raw) throw new PrivateQAError("PRODUCTION_QA_ACCOUNTS_secret_missing");
  if (typeof raw !== "string") throw new PrivateQAError("qa_fixture_json_invalid", "root");
  let config;
  // Accept harmless copy/paste encoding only. No authorization, testOnly or
  // profile attestation is inferred, and passwords are never trimmed/changed.
  let json = raw.replace(/^\uFEFF/, "").trim();
  const fenced = json.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) json = fenced[1];
  try { config = JSON.parse(json); } catch { throw new PrivateQAError("qa_fixture_json_invalid", "root"); }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new PrivateQAError("qa_fixture_root_invalid", "root");
  if (config.version !== 1) throw new PrivateQAError("qa_fixture_version_invalid", "version");
  if (config.authorized !== true) throw new PrivateQAError("explicit_test_fixture_authorization_required", "authorized");
  if (!Array.isArray(config.accounts) || !config.accounts.length || config.accounts.length > 3) throw new PrivateQAError("qa_fixture_accounts_invalid", "accounts");
  const ids = new Set(), emails = new Set(), roles = new Set();
  const accounts = [];
  for (const [index, supplied] of config.accounts.entries()) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new PrivateQAError("qa_account_fixture_invalid", "accounts", index);
    const account = { ...supplied, role: typeof supplied.role === "string" ? supplied.role.trim().toLowerCase() : supplied.role };
    if (!qaRoles.includes(account.role)) throw new PrivateQAError("qa_account_role_invalid", "role", index);
    if (account.testOnly !== true) throw new PrivateQAError("qa_account_test_only_required", "testOnly", index);
    if (account.profilePreexists !== true) throw new PrivateQAError("qa_account_profile_attestation_required", "profilePreexists", index);
    if (typeof account.userId !== "string" || !/^user_[A-Za-z0-9]{3,64}$/.test(account.userId)) throw new PrivateQAError("qa_account_user_id_invalid", "userId", index);
    if (typeof account.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) throw new PrivateQAError("qa_account_email_invalid", "email", index);
    if (typeof account.password !== "string" || account.password.length < 8) throw new PrivateQAError("qa_account_password_invalid", "password", index);
    for (const [field, placeholders] of Object.entries({
      userId: ["user_TestParticipant001", "user_TestVerifier001", "user_TestAdmin001"],
      email: ["participant@example.invalid", "verifier@example.invalid", "admin@example.invalid"],
      password: ["REEMPLAZAR_SOLO_EN_GITHUB", "REEMPLAZAR_EN_GITHUB"],
    })) if (placeholders.includes(account[field])) throw new PrivateQAError("qa_account_placeholder_value", field, index);
    if (ids.has(account.userId) || emails.has(account.email.toLowerCase()) || roles.has(account.role)) throw new PrivateQAError("qa_accounts_must_be_distinct_by_identity_and_role", "accounts", index);
    ids.add(account.userId); emails.add(account.email.toLowerCase()); roles.add(account.role);
    accounts.push(account);
  }
  return accounts;
}

export function expectedReadStatus(role, path) {
  if (!qaRoles.includes(role)) throw new Error("invalid_qa_role");
  if (commonReads.includes(path)) return 200;
  if (adminReads.includes(path)) return role === "admin" ? 200 : 403;
  if (verifierReads.includes(path)) return role === "participant" ? 403 : 200;
  throw new Error("private_qa_endpoint_not_allowlisted");
}
