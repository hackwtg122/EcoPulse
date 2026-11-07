import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { parseQAAccounts, commonReads, adminReads, verifierReads } from "./private-qa-policy.mjs";

const productionApi = "https://ecopulse-3xb4.onrender.com";
const productionFrontend = "https://ecopulseef.netlify.app";

export function percentile(samples, fraction) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

export function summarize(records, wallMs) {
  const latencies = records.map((record) => record.ms);
  const byStatus = {};
  let rateLimited = 0;
  let serverErrors = 0;
  let networkErrors = 0;
  for (const record of records) {
    if (record.status === null) { networkErrors++; continue; }
    byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    if (record.status === 429) rateLimited++;
    if (record.status >= 500) serverErrors++;
  }
  return {
    requests: records.length,
    wallSeconds: Math.round(wallMs / 100) / 10,
    requestsPerSecond: Math.round((records.length / (wallMs / 1000)) * 100) / 100,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.length ? Math.max(...latencies) : null,
    rateLimited,
    serverErrors,
    networkErrors,
    byStatus,
  };
}

function configuration() {
  const mode = process.env.CONCURRENCY_MODE || "public";
  if (!["public", "authenticated"].includes(mode)) throw Error("CONCURRENCY_MODE must be public or authenticated");
  const workers = Number(process.env.CONCURRENCY_WORKERS || "20");
  if (!Number.isInteger(workers) || workers < 1 || workers > 20) throw Error("CONCURRENCY_WORKERS must be 1-20");
  const durationMs = Number(process.env.CONCURRENCY_DURATION_MS || "300000");
  if (!Number.isInteger(durationMs) || durationMs < 60000) throw Error("CONCURRENCY_DURATION_MS must be at least 60000");
  const pauseMs = Number(process.env.CONCURRENCY_PAUSE_MS || "1000");
  if (!Number.isInteger(pauseMs) || pauseMs < 100) throw Error("CONCURRENCY_PAUSE_MS must be at least 100");
  const baseUrl = (process.env.QA_BASE_URL || productionApi).replace(/\/$/, "");
  return { mode, workers, durationMs, pauseMs, baseUrl };
}

async function runPublic(config) {
  if (![productionApi, productionFrontend].includes(config.baseUrl)) throw Error("public_mode_allows_only_official_ecopulse_origins");
  const records = [];
  const started = Date.now();
  const deadline = started + config.durationMs;
  const worker = async () => {
    while (Date.now() < deadline) {
      const begin = Date.now();
      let status = null;
      try {
        const response = await fetch(`${config.baseUrl}/api/version`, {
          headers: { "Cache-Control": "no-cache" },
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        status = response.status;
        await response.arrayBuffer();
      } catch { status = null; }
      records.push({ ms: Date.now() - begin, status });
      const remaining = config.pauseMs - (Date.now() - begin);
      if (remaining > 0) await sleep(Math.min(remaining, deadline - Date.now()));
    }
  };
  await Promise.all(Array.from({ length: config.workers }, worker));
  return summarize(records, Date.now() - started);
}

function readsFor(role) {
  return [...commonReads, ...(role === "admin" ? adminReads : []), ...(role === "verifier" ? verifierReads : ["verifier/capabilities"])];
}

async function runAuthenticated(config) {
  if (process.env.PRIVATE_QA_AUTHORIZED !== "true") throw Error("PRIVATE_QA_AUTHORIZED_required");
  if (config.baseUrl !== productionApi && process.env.CONCURRENCY_ISOLATED !== "true") throw Error("isolated_environment_authorization_required");
  const frontend = (process.env.QA_FRONTEND_URL || productionFrontend).replace(/\/$/, "");
  if (frontend !== productionFrontend && process.env.CONCURRENCY_ISOLATED !== "true") throw Error("isolated_environment_authorization_required");
  const accounts = parseQAAccounts(process.env.PRODUCTION_QA_ACCOUNTS);
  if (!process.env.PROD_QA_MODULES_DIR || !process.env.CHROME_PATH) throw Error("remote_browser_dependencies_required");
  const { chromium } = await import(pathToFileURL(join(process.env.PROD_QA_MODULES_DIR, "playwright-core", "index.mjs")).href);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const records = [];
  const started = Date.now();
  const deadline = started + config.durationMs;
  const sessions = [];
  try {
    for (let index = 0; index < config.workers; index++) {
      const account = accounts[index % accounts.length];
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
      await context.route("**/api/pilot/**", (route) => route.request().method() === "GET" ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(`${frontend}/sign-in`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const identifier = page.locator('input[name="identifier"], input[name="emailAddress"], input[type="email"]').first();
      await identifier.waitFor({ state: "visible", timeout: 30000 });
      await identifier.fill(account.email);
      const password = page.locator('input[type="password"]').first();
      if (!await password.isVisible()) await page.locator('button[type="submit"]').first().click();
      await password.waitFor({ state: "visible", timeout: 30000 });
      await password.fill(account.password);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(`${frontend}/dashboard`, { timeout: 60000 });
      await page.waitForFunction(() => Boolean(window.Clerk?.session), null, { timeout: 30000 });
      sessions.push({ page, account, paths: readsFor(account.role), cursor: 0 });
    }
    const worker = async (session) => {
      while (Date.now() < deadline) {
        const path = session.paths[session.cursor++ % session.paths.length];
        const begin = Date.now();
        let status = null;
        try {
          status = await session.page.evaluate(async ({ api, path }) => {
            const token = await window.Clerk?.session?.getToken();
            if (!token) return 0;
            const response = await fetch(`${api}/api/pilot/${path}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
              credentials: "omit",
              redirect: "error",
              signal: AbortSignal.timeout(30000),
            });
            await response.arrayBuffer();
            return response.status;
          }, { api: config.baseUrl, path });
        } catch { status = null; }
        records.push({ ms: Date.now() - begin, status });
        const remaining = config.pauseMs - (Date.now() - begin);
        if (remaining > 0) await sleep(Math.min(remaining, deadline - Date.now()));
      }
    };
    await Promise.all(sessions.map(worker));
  } finally {
    await browser.close().catch(() => {});
  }
  return summarize(records, Date.now() - started);
}

async function main() {
  const config = configuration();
  const summary = config.mode === "authenticated" ? await runAuthenticated(config) : await runPublic(config);
  console.log(JSON.stringify({
    check: "concurrency_20_sessions",
    mode: config.mode,
    workers: config.workers,
    durationSeconds: Math.round(config.durationMs / 1000),
    baseUrl: config.baseUrl,
    scope: config.mode === "public"
      ? "public_read_only_infrastructure"
      : "authenticated_read_only_allowlisted",
    writesPerformed: 0,
    usersCreated: 0,
    ...summary,
  }));
  if (summary.serverErrors > 0 || summary.networkErrors > 0) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) {
  await main();
}
