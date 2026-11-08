import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Run production functional QA on the remote GitHub runner");

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
const paths = ["/", "/explore", "/materials", "/faq", "/privacy", "/terms", "/contact"];
const results = [];
try {
  for (const profile of profiles) {
    const context = await browser.newContext({ ...profile, baseURL: frontend, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", () => errors.push("browser_script_error"));
    page.on("requestfailed", request => {
      // Navigation routinely cancels in-flight assets; those are not server failures.
      if (request.failure()?.errorText === "net::ERR_ABORTED") return;
      const url = new URL(request.url());
      if (url.origin === frontend || url.origin === api) errors.push(`failed_${url.origin === api ? "api" : "asset"}:${url.pathname}`);
    });
    for (const path of paths) {
      errors.length = 0;
      try {
        const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 20000 });
        const heading = (await page.locator("h1").first().innerText()).trim().slice(0, 120);
        if (path === "/" || path === "/explore") {
          if (path === "/") {
            await page.getByTestId("link-explore-without-account").waitFor({ state: "visible" });
            await page.getByText("Relatos ilustrativos").waitFor({ state: "visible" });
          }
          await page.waitForTimeout(300);
          const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
          if (overflow > 5) throw new Error("horizontal_scroll_overflow:" + overflow);
        }
        if (path === "/privacy") {
          const body = await page.locator("body").innerText();
          for (const text of ["PostgreSQL vinculadas a tu cuenta", "proveedor de IA", "eliminar cada conversación desde EcoGuía"]) {
            if (!body.includes(text)) throw new Error(`privacy_copy_missing:${text}`);
          }
        }
        if (path === "/faq") {
          const body = await page.locator("body").innerText();
          for (const text of ["guía rápida del inicio", "no usa IA"]) {
            if (!body.includes(text)) throw new Error(`faq_copy_missing:${text}`);
          }
        }
        results.push({ profile: profile.name, path, status: response?.status(), heading, errors: [...errors], pass: response?.status() === 200 && Boolean(heading) && errors.length === 0 });
      } catch (error) {
        results.push({ profile: profile.name, path, status: null, errors: [...errors], pass: false, reason: "navigation_visible_heading_or_public_copy_failed", detail: String(error?.message ?? error).slice(0, 160) });
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
    errors.length = 0;
    let quickGuideStep = "open";
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.getByTestId("button-open-landing-chat").click();
      const panel = page.getByTestId("landing-chat-panel");
      await panel.waitFor({ state: "visible", timeout: 15000 });
      quickGuideStep = "labels";
      const input = page.getByTestId("input-landing-chat");
      if ((await input.getAttribute("maxlength")) !== "500") throw new Error("quick_guide_maxlength_missing");
      if ((await input.getAttribute("aria-label")) !== "Pregunta para la guía rápida") throw new Error("quick_guide_label_missing");
      quickGuideStep = "focus_input";
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "input-landing-chat", undefined, { timeout: 15000 });
      const questions = ["¿Dónde va el vidrio?", "¿Cómo gano puntos?", "¿Dónde va el papel?", "¿Qué hago con una lata?"];
      for (const [index, question] of questions.entries()) {
        quickGuideStep = `message_${index + 1}`;
        await input.fill(question);
        await input.press("Enter");
        await page.waitForFunction(expected => (document.querySelector('[data-testid="landing-chat-messages"]')?.children.length ?? 0) >= expected, 3 + index * 2, { timeout: 15000 });
      }
      quickGuideStep = "scroll";
      await page.waitForFunction(() => { const list = document.querySelector('[data-testid="landing-chat-messages"]'); return !!list && list.scrollTop + list.clientHeight >= list.scrollHeight - 2; }, undefined, { timeout: 15000 });
      quickGuideStep = "escape";
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden", timeout: 15000 });
      quickGuideStep = "focus_launcher_escape";
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "button-open-landing-chat", undefined, { timeout: 15000 });
      quickGuideStep = "close_button";
      await page.getByTestId("button-open-landing-chat").click();
      await panel.waitFor({ state: "visible", timeout: 15000 });
      await page.getByTestId("button-close-landing-chat").click();
      await panel.waitFor({ state: "hidden", timeout: 15000 });
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "button-open-landing-chat", undefined, { timeout: 15000 });
      quickGuideStep = "sign_in_redirect";
      await page.getByTestId("button-open-landing-chat").click();
      await panel.waitFor({ state: "visible", timeout: 15000 });
      await page.getByTestId("link-landing-real-guide").click();
      await page.waitForURL(url => url.pathname === "/sign-in" && url.searchParams.get("redirect_url") === "/chat", { timeout: 20000 });
      await page.locator('input[name="identifier"]').waitFor({ state: "visible", timeout: 20000 });
      results.push({ profile: profile.name, path: "/ (quick guide flow)", status: 200, heading: "quick_guide_scroll_escape_focus_redirect", errors: [...errors], pass: errors.length === 0 });
    } catch (error) {
      results.push({ profile: profile.name, path: "/ (quick guide flow)", status: null, errors: [...errors], pass: false, reason: `quick_guide_failed_at_${quickGuideStep}`, detail: String(error?.message ?? error).slice(0, 160) });
    }
    for (const path of ["/deliveries", "/rewards", "/admin", "/admin?section=settings", "/admin/centers", "/admin/rewards", "/admin/users"]) {
      errors.length = 0;
      try {
        await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForURL(url => url.pathname === "/" || url.pathname.startsWith("/sign-in"), { timeout: 20000 });
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });
        results.push({ profile: profile.name, path, pass: errors.length === 0, errors: [...errors], scope: "anonymous_browser_protection_not_authenticated_operation" });
      } catch {
        results.push({ profile: profile.name, path, pass: false, errors: [...errors], reason: "private_page_protection_or_browser_failed", scope: "anonymous_browser_protection_not_authenticated_operation" });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
for (const row of results) console.log(JSON.stringify(row));
console.log(JSON.stringify({ total: results.length, passed: results.filter(row => row.pass).length, failed: results.filter(row => !row.pass).length }));
if (results.some(row => !row.pass)) process.exitCode = 1;
