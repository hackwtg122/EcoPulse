export const qaRoles = ["participant", "verifier", "admin"];
export const commonReads = ["me", "balance", "point-movements", "favorites", "progress", "scans", "scans/ai-capabilities", "guide/capabilities", "delivery-points", "evaluation-points", "delivery-options", "deliveries", "rewards/capabilities", "rewards", "redemptions"];
export const adminReads = ["admin/catalog", "admin/stats", "admin/rewards", "admin/redemptions", "admin/users"];
export const verifierReads = ["verifier/capabilities", "verifier/deliveries"];
export const privatePages = ["/dashboard", "/profile", "/security", "/map", "/scan", "/chat", "/deliveries", "/progress", "/rewards"];

export function parseQAAccounts(raw) {
  if (!raw) throw new Error("PRODUCTION_QA_ACCOUNTS_secret_missing");
  let config;
  try { config = JSON.parse(raw); } catch { throw new Error("qa_fixture_json_invalid"); }
  if (config?.version !== 1 || config.authorized !== true || !Array.isArray(config.accounts) || !config.accounts.length || config.accounts.length > 3) {
    throw new Error("explicit_test_fixture_authorization_required");
  }
  const ids = new Set(), emails = new Set(), roles = new Set();
  for (const account of config.accounts) {
    if (!account || !qaRoles.includes(account.role) || account.testOnly !== true || account.profilePreexists !== true ||
        typeof account.userId !== "string" || !/^user_[A-Za-z0-9]{3,64}$/.test(account.userId) ||
        typeof account.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) ||
        typeof account.password !== "string" || account.password.length < 8) throw new Error("qa_account_fixture_invalid");
    if (ids.has(account.userId) || emails.has(account.email.toLowerCase()) || roles.has(account.role)) throw new Error("qa_accounts_must_be_distinct_by_identity_and_role");
    ids.add(account.userId); emails.add(account.email.toLowerCase()); roles.add(account.role);
  }
  return config.accounts;
}

export function expectedReadStatus(role, path) {
  if (!qaRoles.includes(role)) throw new Error("invalid_qa_role");
  if (commonReads.includes(path)) return 200;
  if (adminReads.includes(path)) return role === "admin" ? 200 : 403;
  if (verifierReads.includes(path)) return role === "participant" ? 403 : 200;
  throw new Error("private_qa_endpoint_not_allowlisted");
}
