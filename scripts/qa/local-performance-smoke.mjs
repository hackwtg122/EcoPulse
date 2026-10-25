import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modules = process.env.PROD_QA_MODULES_DIR;
if (!modules || !process.env.CHROME_PATH) throw new Error("Set PROD_QA_MODULES_DIR and CHROME_PATH");
const { chromium } = await import(pathToFileURL(join(modules, "playwright-core", "index.mjs")).href);
// Read-only smoke checks: never submit forms or accept an arbitrary target.
const origin = process.env.QA_BASE_URL || "http://127.0.0.1:5174";
if (!["http://127.0.0.1:5174", "https://ecopulseef.netlify.app"].includes(origin)) {
  throw new Error("QA_BASE_URL must be the local preview or EcoPulse production");
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    const assets = new Set();
    page.on("pageerror", () => errors.push("script_error"));
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith("/assets/")) assets.add(url.pathname);
    });
    for (const route of ["/", "/materials", "/faq", "/privacy", "/terms", "/contact"]) {
      errors.length = 0;
      assets.clear();
      const response = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 25000 });
      const correctChunk = route !== "/" || ![...assets].some(asset => asset.includes("interactive-map-") || asset.includes("materials-page-"));
      results.push({ route, width: viewport.width, pass: response?.status() === 200 && errors.length === 0 && correctChunk, errors, correctChunk });
      if (route === "/") {
        await page.waitForFunction(() => document.querySelector('link[href*="fonts.googleapis.com/css2"]')?.rel === "stylesheet", null, { timeout: 25000 });
        results.push({ route: "Google Fonts non-blocking stylesheet applied", width: viewport.width, pass: await page.evaluate(() => document.querySelector('link[href*="fonts.googleapis.com/css2"]')?.rel === "stylesheet") });
      }
    }
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByTestId("link-landing-materials").click();
    await page.getByTestId("input-material-search").fill("pilas");
    await page.locator('[data-testid^="material-card-"]').first().click();
    await page.getByTestId("material-ficha-title").waitFor({ state: "visible" });
    results.push({ route: "/materials/:id (navigation)", width: viewport.width, pass: errors.length === 0 });
    for (const route of ["/sign-in", "/sign-up", "/dashboard"]) {
      errors.length = 0;
      await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      const pathname = new URL(page.url()).pathname;
      const pass = route === "/dashboard" ? pathname === "/" : pathname === route && (await page.locator("input").count()) >= 2;
      results.push({ route, width: viewport.width, pass: pass && errors.length === 0, pathname, errors });
    }
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByTestId("link-sign-in").click();
    await page.locator("input").first().waitFor({ state: "visible", timeout: 25000 });
    const signInNavigation = new URL(page.url()).pathname === "/sign-in";
    await page.getByTestId("link-auth-brand").click();
    await page.getByTestId("link-sign-up").click();
    await page.getByTestId("input-signup-email").waitFor({ state: "visible", timeout: 25000 });
    results.push({ route: "SPA / -> sign-in -> / -> sign-up", width: viewport.width, pass: signInNavigation && new URL(page.url()).pathname === "/sign-up" && errors.length === 0 });
    for (const route of ["/scan", "/map", "/profile", "/security", "/admin", "/rewards", "/chat"]) {
      await page.goto(origin + route, { waitUntil: "domcontentloaded" });
      await page.waitForURL(origin + "/", { timeout: 25000 });
      results.push({ route: `${route} (anonymous)`, width: viewport.width, pass: new URL(page.url()).pathname === "/" });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
results.forEach(row => console.log(JSON.stringify(row)));
console.log(JSON.stringify({ total: results.length, pass: results.filter(row => row.pass).length, fail: results.filter(row => !row.pass).length }));
if (results.some(row => !row.pass)) process.exitCode = 1;
