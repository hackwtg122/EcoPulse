import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseQAAccounts, qaRoles, commonReads, adminReads, verifierReads, privatePages, expectedReadStatus } from "./private-qa-policy.mjs";

const frontend = "https://ecopulseef.netlify.app";
const api = "https://ecopulse-3xb4.onrender.com";
const results = [];
const report = (role, check, status, reason) => results.push({ role, check, status, ...(reason ? { reason } : {}) });
let browser;
async function readAccount(page, path, account) {
  expectedReadStatus(account.role, path); // rejects all non-allowlisted paths
  return page.evaluate(async ({ api, path, expectedId, expectedRole }) => {
    const token = await window.Clerk?.session?.getToken();
    if (!token) return { status: 0, identityMatches: false };
    const response = await fetch(`${api}/api/pilot/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", credentials: "omit", redirect: "error" });
    let body;
    try { body = await response.json(); } catch { return { status: response.status, json: false }; }
    // No rows, tokens, emails or account IDs leave the browser process.
    return { status: response.status, json: true,
      identityMatches: path === "me" ? body.id === expectedId && body.role === expectedRole : undefined,
      adminCount: path === "admin/users" ? body.adminCount : undefined,
      aiEnabled: path === "scans/ai-capabilities" || path === "guide/capabilities" ? body.enabled : undefined };
  }, { api, path, expectedId: account.userId, expectedRole: account.role });
}

async function run() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "hackwtg122/EcoPulse" || process.env.GITHUB_REF !== "refs/heads/main") throw new Error("official_main_remote_runner_required");
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.PRIVATE_QA_AUTHORIZED !== "true") throw new Error("explicit_private_run_authorization_required");
  const accounts = parseQAAccounts(process.env.PRODUCTION_QA_ACCOUNTS);
  const expectedSha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/i.test(expectedSha || "")) throw new Error("expected_commit_required");
  const assertVersion = async () => {
    const options = { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000), redirect: "error" };
    const [response, site] = await Promise.all([
      fetch(`${api}/api/version`, options),
      fetch("https://api.netlify.com/api/v1/sites/ecopulseef.netlify.app", options),
    ]);
    if (!response.ok || (await response.json()).commit !== expectedSha) throw new Error("private_run_deployed_commit_mismatch");
    if (!site.ok) throw new Error("private_run_frontend_commit_unverified");
    const deploy = (await site.json()).published_deploy;
    if (deploy?.state !== "ready" || deploy?.commit_ref !== expectedSha) throw new Error("private_run_frontend_commit_mismatch");
  };
  await assertVersion();
  if (!process.env.PROD_QA_MODULES_DIR || !process.env.CHROME_PATH) throw new Error("remote_browser_dependencies_required");
  const { chromium } = await import(pathToFileURL(join(process.env.PROD_QA_MODULES_DIR, "playwright-core", "index.mjs")).href);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  for (const role of qaRoles) {
    const account = accounts.find(row => row.role === role);
    if (!account) { report(role, "private_suite", "BLOCKED", "authorized_test_account_not_supplied"); continue; }
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
    // This first suite does not mutate app records. Clerk login/logout does
    // create/revoke a test session. The API may attempt profile INSERT on GET;
    // fixtures must refer to already provisioned profiles, never real users.
    await context.route(`${api}/api/pilot/**`, route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort());
    const page = await context.newPage();
    let jsErrors = 0;
    page.on("pageerror", () => { jsErrors++; });
    let identityVerified = false;
    try {
      await page.goto(`${frontend}/sign-in`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const identifier = page.locator('input[name="identifier"], input[name="emailAddress"], input[type="email"]').first();
      await identifier.waitFor({ state: "visible", timeout: 30000 });
      await identifier.fill(account.email);
      const password = page.locator('input[type="password"]').first();
      if (!await password.isVisible()) await page.locator('button[type="submit"]').first().click();
      await password.waitFor({ state: "visible", timeout: 30000 });
      await password.fill(account.password);
      await page.locator('button[type="submit"]').first().click();
      // Do not bypass CAPTCHA, OTP, recovery or MFA. Such a factor blocks this
      // fixture until an authorized runner-compatible test session is provided.
      await page.waitForURL(`${frontend}/dashboard`, { timeout: 60000 });
      await page.waitForFunction(() => Boolean(window.Clerk?.session), null, { timeout: 30000 });
      const me = await readAccount(page, "me", account);
      if (me.status !== 200 || !me.identityMatches) throw new Error("fixture_identity_or_role_mismatch");
      identityVerified = true;
      report(role, "login_and_expected_identity", "PASS");
      if (role === "admin") {
        const users = await readAccount(page, "admin/users", account);
        if (users.status !== 200 || !Number.isInteger(users.adminCount) || users.adminCount < 2) {
          report(role, "admin_suite", "BLOCKED", "test_admin_must_not_be_last_administrator");
          continue;
        }
      }
      await page.getByTestId("dashboard-real-data").waitFor({ state: "visible", timeout: 60000 });
      report(role, "dashboard_real_reads", "PASS");
      for (const path of [...commonReads, ...adminReads, ...verifierReads]) {
        const response = await readAccount(page, path, account);
        const expected = expectedReadStatus(role, path);
        report(role, `GET ${path}`, response.status === expected && response.json ? "PASS" : "FAIL",
          response.status === expected && response.json ? undefined : `expected_${expected}_received_${response.status}`);
        if (path.endsWith("ai-capabilities") || path === "guide/capabilities") {
          report(role, `${path}_real_inference`, "BLOCKED", response.aiEnabled ? "real_free_provider_call_and_input_not_authorized_by_this_read_suite" : "provider_capability_disabled");
        }
      }
      const pages = [...privatePages, ...(role === "participant" ? [] : ["/admin"]), ...(role === "admin" ? ["/admin/users", "/admin/centers", "/admin/rewards"] : [])];
      for (const path of pages) {
        jsErrors = 0;
        await page.goto(`${frontend}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForFunction(() => document.querySelector('[data-testid="pilot-api-status"]')?.textContent === "API conectada", null, { timeout: 60000 });
        await page.locator("h1,h2").first().waitFor({ state: "visible", timeout: 30000 });
        // A page load is not proof that every control/CRUD action works.
        report(role, `route_shell_load ${path}`, jsErrors === 0 && new URL(page.url()).pathname === path ? "PASS" : "FAIL");
      }
      await page.goto(`${frontend}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(window.Clerk?.session), null, { timeout: 30000 });
      const resumed = await readAccount(page, "me", account);
      report(role, "session_reload_identity", resumed.status === 200 && resumed.identityMatches ? "PASS" : "FAIL");
      await page.getByTestId("button-logout-header").click();
      await page.waitForURL(`${frontend}/sign-in`, { timeout: 30000 });
      await page.waitForFunction(() => !window.Clerk?.session, null, { timeout: 30000 });
      await page.goto(`${frontend}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(`${frontend}/`, { timeout: 30000 });
      report(role, "logout_and_private_route_denial", "PASS");
    } catch (error) {
      const reason = ["fixture_identity_or_role_mismatch"].includes(error?.message) ? error.message : identityVerified ? "authenticated_check_failed_details_suppressed" : "login_requires_factor_or_credentials_rejected";
      report(role, "private_suite", identityVerified ? "FAIL" : "BLOCKED", reason);
    } finally {
      // Only this newly created browser's test session; no backend master key,
      // sign-in token minting, role changes, screenshots or trace artifacts.
      await page.evaluate(async () => { if (window.Clerk?.session) await window.Clerk.signOut(); }).catch(() => {});
      await context.close().catch(() => {});
    }
  }
  await assertVersion();
  for (const check of ["registration_and_profile_bootstrap", "password_recovery_and_mfa", "profile_mutation_persistence", "favorites_mutation_persistence", "manual_scan_persistence", "delivery_create_and_events", "physical_verification_and_points", "reward_publication_redemption_fulfillment", "role_changes_and_audit", "cross_user_record_isolation"]) {
    report("all", check, "BLOCKED", "requires_separately_authorized_test_records_or_sensitive_operation");
  }
}
try { await run(); }
catch { report("all", "private_suite_setup", "BLOCKED", "missing_or_invalid_authorized_fixtures_or_runner_configuration"); }
finally { await browser?.close().catch(() => {}); }
for (const result of results) console.log(JSON.stringify(result));
const summary = { scope: "authenticated_reads_and_session_only", passed: results.filter(x => x.status === "PASS").length, failed: results.filter(x => x.status === "FAIL").length, blocked: results.filter(x => x.status === "BLOCKED").length };
console.log(JSON.stringify(summary));
if (summary.failed || summary.blocked) process.exitCode = 1;
