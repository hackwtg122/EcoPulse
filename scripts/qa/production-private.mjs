import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { parseQAAccounts, qaRoles, commonReads, adminReads, verifierReads, privatePages, expectedReadStatus, PrivateQAError, safePrivateDiagnostic } from "./private-qa-policy.mjs";
import { reversibleFavoriteCheck } from "./private-write-check.mjs";

const frontend = "https://ecopulseef.netlify.app";
const api = "https://ecopulse-3xb4.onrender.com";
const results = [];
const realAiAuthorized = process.env.PRIVATE_QA_AI_AUTHORIZED === "true";
const report = (role, check, status, reason, scope = "authenticated_reads_and_session") => {
  const row = { role, check, status, scope, ...(reason ? { reason } : {}) };
  results.push(row);
  return row;
};
let browser;
let setupStage = "runner_validation";
async function readAccount(page, path, account) {
  expectedReadStatus(account.role, path); // rejects all non-allowlisted paths
  return page.evaluate(async ({ api, path, expectedId, expectedRole }) => {
    let token;
    try { token = await window.Clerk?.session?.getToken(); } catch { /* report only a boolean */ }
    if (!token) return { status: 0, identityMatches: false, tokenAvailable: false };
    let response;
    try { response = await fetch(`${api}/api/pilot/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30000) }); }
    catch { return { status: 0, json: false, tokenAvailable: true }; }
    let body;
    try { body = await response.json(); } catch { return { status: response.status, json: false }; }
    // No rows, tokens, emails or account IDs leave the browser process.
    return { status: response.status, json: true,
      identityMatches: path === "me" ? body.id === expectedId && body.role === expectedRole : undefined,
      userMatches: path === "me" ? body.id === expectedId : undefined,
      roleMatches: path === "me" ? body.role === expectedRole : undefined,
      adminCount: path === "admin/users" ? body.adminCount : undefined,
      aiEnabled: path === "scans/ai-capabilities" || path === "guide/capabilities" ? body.enabled : undefined };
  }, { api, path, expectedId: account.userId, expectedRole: account.role });
}

async function run() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "hackwtg122/EcoPulse" || process.env.GITHUB_REF !== "refs/heads/main") throw new PrivateQAError("official_main_remote_runner_required");
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.PRIVATE_QA_AUTHORIZED !== "true") throw new PrivateQAError("explicit_private_run_authorization_required");
  report("all", "setup_runner", "PASS", undefined, "setup_validation");
  setupStage = "fixture_validation";
  const accounts = parseQAAccounts(process.env.PRODUCTION_QA_ACCOUNTS);
  report("all", "setup_fixture_structure", "PASS", undefined, "setup_validation");
  setupStage = "expected_commit";
  const expectedSha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/i.test(expectedSha || "")) throw new PrivateQAError("expected_commit_required");
  const assertVersion = async () => {
    const options = { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000), redirect: "error" };
    const [response, site] = await Promise.all([
      fetch(`${api}/api/version`, options),
      fetch("https://api.netlify.com/api/v1/sites/ecopulseef.netlify.app", options),
    ]);
    if (!response.ok || (await response.json()).commit !== expectedSha) throw new PrivateQAError("private_run_deployed_commit_mismatch");
    if (!site.ok) throw new PrivateQAError("private_run_frontend_commit_unverified");
    const deploy = (await site.json()).published_deploy;
    if (deploy?.state !== "ready" || deploy?.commit_ref !== expectedSha) throw new PrivateQAError("private_run_frontend_commit_mismatch");
  };
  setupStage = "deployment_identity";
  const deadline = Date.now() + 180000;
  while (true) {
    try { await assertVersion(); break; }
    catch (error) {
      if (Date.now() >= deadline) throw error instanceof PrivateQAError ? error : new PrivateQAError("private_run_remote_identity_unavailable");
      await setTimeout(5000);
    }
  }
  report("all", "setup_deployed_commits", "PASS", undefined, "setup_validation");
  setupStage = "browser_dependencies";
  if (!process.env.PROD_QA_MODULES_DIR || !process.env.CHROME_PATH) throw new PrivateQAError("remote_browser_dependencies_required");
  let chromium;
  try { ({ chromium } = await import(pathToFileURL(join(process.env.PROD_QA_MODULES_DIR, "playwright-core", "index.mjs")).href)); }
  catch { throw new PrivateQAError("remote_browser_module_unavailable"); }
  setupStage = "browser_launch";
  try { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true }); }
  catch { throw new PrivateQAError("remote_browser_launch_failed"); }
  report("all", "setup_browser", "PASS", undefined, "setup_validation");
  setupStage = "account_checks";
  for (const role of qaRoles) {
    const account = accounts.find(row => row.role === role);
    if (!account) { report(role, "private_suite", "BLOCKED", "authorized_test_account_not_supplied"); continue; }
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
    // This first suite does not mutate app records. Clerk login/logout does
    // create/revoke a test session. The API may attempt profile INSERT on GET;
    // fixtures must refer to already provisioned profiles, never real users.
    let identityApproved = false;
    let reversibleWriteApproved = false;
    let aiInferenceApproved = false;
    await context.route(`${api}/api/pilot/**`, route => {
      const request = route.request(), method = request.method(), url = new URL(request.url());
      const allowedFavorite = reversibleWriteApproved && role === "participant" && ["POST", "DELETE"].includes(method) && /^\/api\/pilot\/favorites\/[0-9a-f-]{36}$/i.test(url.pathname);
      const allowedInference = aiInferenceApproved && role === "participant" && method === "POST" && ["/api/pilot/guide/ask", "/api/pilot/scans/classify"].includes(url.pathname);
      return identityApproved && (["GET", "HEAD", "OPTIONS"].includes(method) || allowedFavorite || allowedInference) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    let jsErrors = 0;
    page.on("pageerror", () => { jsErrors++; });
    let identityVerified = false;
    let accountStage = "login_identifier";
    let clerkFailure;
    const clerkCodes = { form_identifier_not_found: "qa_clerk_account_not_found", identifier_not_found: "qa_clerk_account_not_found", form_password_incorrect: "qa_clerk_password_rejected", captcha_invalid: "qa_clerk_captcha_required", captcha_failed: "qa_clerk_captcha_required" };
    page.on("response", async response => {
      try {
        const url = new URL(response.url());
        const trusted = url.hostname.endsWith(".clerk.accounts.dev") || (url.origin === api && url.pathname.startsWith("/api/__clerk/"));
        if (trusted && url.pathname.includes("/client/sign_ins") && response.status() >= 400) {
          const code = (await response.json())?.errors?.[0]?.code;
          if (Object.hasOwn(clerkCodes, code)) clerkFailure = clerkCodes[code];
        }
      } catch { /* Never emit provider response bodies or exception messages. */ }
    });
    try {
      await page.goto(`${frontend}/sign-in`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const identifier = page.locator('input[name="identifier"], input[name="emailAddress"], input[type="email"]').first();
      await identifier.waitFor({ state: "visible", timeout: 30000 });
      await identifier.fill(account.email);
      accountStage = "login_password";
      const password = page.locator('input[type="password"]').first();
      if (!await password.isVisible()) await page.locator('button[type="submit"]').first().click();
      await password.waitFor({ state: "visible", timeout: 30000 });
      await password.fill(account.password);
      await page.locator('button[type="submit"]').first().click();
      accountStage = "login_completion";
      // Do not bypass CAPTCHA, OTP, recovery or MFA. Such a factor blocks this
      // fixture until an authorized runner-compatible test session is provided.
      await page.waitForURL(`${frontend}/dashboard`, { timeout: 60000 });
      await page.waitForFunction(() => Boolean(window.Clerk?.session && window.Clerk?.user), null, { timeout: 30000 });
      accountStage = "principal_identity";
      const principalMatches = await page.evaluate(expectedId => window.Clerk?.user?.id === expectedId, account.userId);
      if (!principalMatches) throw new PrivateQAError("qa_fixture_identity_mismatch");
      // No app request/profile upsert is allowed before checking the Clerk ID.
      identityApproved = true;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(window.Clerk?.session), null, { timeout: 30000 });
      accountStage = "profile_and_role";
      const me = await readAccount(page, "me", account);
      if (me.tokenAvailable === false) throw new PrivateQAError("qa_api_session_token_unavailable");
      if (me.status === 401) throw new PrivateQAError("qa_api_session_rejected");
      if (me.status !== 200) throw new PrivateQAError("qa_profile_or_api_unavailable");
      if (!me.userMatches) throw new PrivateQAError("qa_fixture_identity_mismatch");
      if (!me.roleMatches) throw new PrivateQAError("qa_application_role_mismatch");
      identityVerified = true;
      report(role, "login_and_expected_identity", "PASS");
      accountStage = "authenticated_reads";
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
          if (!realAiAuthorized || role !== "participant") report(role, `${path}_real_inference`, "BLOCKED", response.aiEnabled ? "real_provider_calls_require_explicit_participant_opt_in" : "provider_capability_disabled", "deferred_inference");
        }
      }
      if (realAiAuthorized && role === "participant") {
        aiInferenceApproved = true;
        try {
          await verifyRealAi(page, role);
        } finally { aiInferenceApproved = false; }
      }
      if (role === "participant") {
        if (account.reversibleWritesAuthorized !== true) {
          report(role, "favorite_write_and_cleanup", "BLOCKED", "reversible_writes_not_authorized", "reversible_writes");
        } else {
          reversibleWriteApproved = true;
          try {
            const result = await page.evaluate(reversibleFavoriteCheck, api);
            report(role, "favorite_write_and_cleanup", result.status, result.reason, "reversible_writes");
          } finally { reversibleWriteApproved = false; }
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
      const diagnostic = safePrivateDiagnostic(error);
      const reason = diagnostic.reason !== "private_setup_unexpected_error" ? diagnostic.reason : identityVerified ? "authenticated_check_failed_details_suppressed" : clerkFailure || "qa_login_interactive_factor_or_incomplete";
      report(role, "private_suite", identityVerified ? "FAIL" : "BLOCKED", reason).stage = accountStage;
    } finally {
      // Only this newly created browser's test session; no backend master key,
      // sign-in token minting, role changes, screenshots or trace artifacts.
      await page.evaluate(async () => { if (window.Clerk?.session) await window.Clerk.signOut(); }).catch(() => {});
      await context.close().catch(() => {});
    }
  }
  setupStage = "final_deployment_identity";
  await assertVersion();
  for (const check of ["registration_and_profile_bootstrap", "password_recovery_and_mfa", "profile_mutation_persistence", "favorites_mutation_persistence", "manual_scan_persistence", "delivery_create_and_events", "physical_verification_and_points", "reward_publication_redemption_fulfillment", "role_changes_and_audit", "cross_user_record_isolation"]) {
    report("all", check, "BLOCKED", "requires_separately_authorized_test_records_or_sensitive_operation", "deferred_write_flows");
  }
}

async function verifyRealAi(page, role) {
  // Exercise the actual deployed UI, consent and authenticated endpoints. Never
  // fabricate responses, mint sessions, auto-save records or award points.
  for (const kind of ["ecoguide", "ecoscan"]) {
    let failureReason = "live_ui_or_provider_check_failed";
    try {
      await page.goto(`${frontend}${kind === "ecoguide" ? "/chat" : "/scan"}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (kind === "ecoguide") {
        // Keep this inference-only suite separate from stored conversations.
        // Never append its question to a previously saved conversation.
        await page.getByTestId("button-new-guide-conversation").click();
        const consent = page.getByTestId("guide-consent");
        await consent.waitFor({ state: "visible", timeout: 30000 });
        await page.waitForFunction(() => !document.querySelector('[data-testid="guide-consent"]')?.disabled, null, { timeout: 30000 });
        await consent.check();
        await page.getByTestId("input-chat-message").fill("¿Cómo separo el vidrio para reciclar?");
        const [response] = await Promise.all([
          page.waitForResponse(r => r.url() === `${api}/api/pilot/guide/ask` && r.request().method() === "POST", { timeout: 210000 }),
          page.getByTestId("button-send-chat").click(),
        ]);
        failureReason = `live_inference_http_${response.status()}`;
        if (!response.ok()) { report(role, kind, response.status() === 429 || response.status() === 503 ? "BLOCKED" : "FAIL", failureReason, "real_ai_inference"); continue; }
        failureReason = "invalid_live_inference_response";
        const result = await response.json();
        if (result?.source !== "ai" || typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 800) throw new Error();
        await page.locator('[data-testid^="message-a-"]').last().waitFor({ state: "visible", timeout: 15000 });
        report(role, kind, "PASS", undefined, "real_ai_inference");
      } else {
        const input = page.getByTestId("input-ai-upload");
        await input.waitFor({ state: "attached", timeout: 30000 });
        await input.setInputFiles(fileURLToPath(new URL("../../artifacts/api-server/src/lib/fixtures/plastic-water-bottle.png", import.meta.url)));
        await page.getByTestId("checkbox-ai-consent").check();
        const [response] = await Promise.all([
          page.waitForResponse(r => r.url() === `${api}/api/pilot/scans/classify` && r.request().method() === "POST", { timeout: 210000 }),
          page.getByTestId("button-ai-analyze").click(),
        ]);
        failureReason = `live_inference_http_${response.status()}`;
        if (!response.ok()) { report(role, kind, response.status() === 429 || response.status() === 503 ? "BLOCKED" : "FAIL", failureReason, "real_ai_inference"); continue; }
        failureReason = "invalid_live_inference_response";
        const result = await response.json();
        if (result?.source !== "ai_suggestion" || result.persisted !== false || result.points !== 0 || result.category !== "plastic") throw new Error();
        await page.getByTestId("ai-scan-result").waitFor({ state: "visible", timeout: 15000 });
        if (await page.getByTestId("ai-scan-saved").count()) throw new Error();
        report(role, kind, "PASS", "real_reference_photo_not_saved", "real_ai_inference");
      }
    } catch {
      report(role, kind, "FAIL", failureReason, "real_ai_inference");
    }
  }
}
try { await run(); }
catch (error) { Object.assign(report("all", "private_suite_setup", "BLOCKED", safePrivateDiagnostic(error).reason), safePrivateDiagnostic(error), { stage: setupStage }); }
finally { await browser?.close().catch(() => {}); }
for (const result of results) console.log(JSON.stringify(result));
const tested = results.filter(x => x.scope === "authenticated_reads_and_session");
const summary = { scope: "authenticated_reads_and_session_only", passed: tested.filter(x => x.status === "PASS").length, failed: tested.filter(x => x.status === "FAIL").length, blocked: tested.filter(x => x.status === "BLOCKED").length, deferredBlocked: results.filter(x => x.scope !== "authenticated_reads_and_session" && x.status === "BLOCKED").length, systemComplete: false };
console.log(JSON.stringify(summary));
if (summary.failed || summary.blocked || results.some(x => (x.scope === "reversible_writes" && x.status === "FAIL") || (x.scope === "real_ai_inference" && x.status !== "PASS"))) process.exitCode = 1;
