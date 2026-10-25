import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Deliberately public/read-only: never accepts credentials or arbitrary URLs.
const frontend = "https://ecopulseef.netlify.app";
const api = "https://ecopulse-3xb4.onrender.com";
const modules = process.env.PROD_QA_MODULES_DIR;
if (!modules || !process.env.CHROME_PATH) {
  throw new Error("Set PROD_QA_MODULES_DIR and CHROME_PATH (no local server required)");
}
const { chromium } = await import(pathToFileURL(join(modules, "playwright-core", "index.mjs")).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const profiles = [
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 },
  { name: "tablet", viewport: { width: 768, height: 1024 }, isMobile: true, deviceScaleFactor: 1 },
  { name: "desktop", viewport: { width: 1366, height: 900 }, isMobile: false, deviceScaleFactor: 1 },
];
const paths = ["/", "/materials", "/faq", "/privacy", "/terms", "/contact"];
const results = [];
try {
  for (const profile of profiles) {
    const context = await browser.newContext({ ...profile, baseURL: frontend, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", () => errors.push("browser_script_error"));
    page.on("requestfailed", request => {
      const url = new URL(request.url());
      if (url.origin === frontend || url.origin === api) errors.push(`failed_${url.origin === api ? "api" : "asset"}:${url.pathname}`);
    });
    for (const path of paths) {
      errors.length = 0;
      try {
        const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 20000 });
        const heading = (await page.locator("h1").first().innerText()).trim().slice(0, 120);
        results.push({ profile: profile.name, path, status: response?.status(), heading, errors: [...errors], pass: response?.status() === 200 && Boolean(heading) && errors.length === 0 });
      } catch {
        results.push({ profile: profile.name, path, status: null, errors: [...errors], pass: false, reason: "navigation_or_visible_heading_failed" });
      }
    }
    errors.length = 0;
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.getByTestId("link-landing-materials").click();
      await page.waitForURL("**/materials", { timeout: 15000 });
      await page.getByTestId("input-material-search").fill("pilas");
      await page.locator('[data-testid^="material-card-"]').first().waitFor({ state: "visible" });
      await page.getByTestId("input-material-search").fill("zzzz-material-inexistente");
      await page.getByTestId("empty-material-results").waitFor({ state: "visible" });
      await page.getByTestId("button-clear-material-search").click();
      await page.locator('[data-testid^="material-card-"]').first().click();
      await page.getByTestId("material-ficha-title").waitFor({ state: "visible" });
      const ficha = (await page.getByTestId("material-ficha-title").innerText()).slice(0, 100);
      await page.getByTestId("link-back-materials").click();
      await page.waitForURL("**/materials", { timeout: 15000 });
      results.push({ profile: profile.name, path: "/materials (public flow)", status: 200, heading: ficha, errors: [...errors], pass: errors.length === 0 });
    } catch {
      results.push({ profile: profile.name, path: "/materials (public flow)", status: null, errors: [...errors], pass: false, reason: "public_link_search_or_ficha_failed" });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
for (const row of results) console.log(JSON.stringify(row));
console.log(JSON.stringify({ total: results.length, passed: results.filter(row => row.pass).length, failed: results.filter(row => !row.pass).length }));
if (results.some(row => !row.pass)) process.exitCode = 1;
