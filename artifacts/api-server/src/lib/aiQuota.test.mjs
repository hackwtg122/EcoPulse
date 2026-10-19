import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadQuotaState, recordAttempt, reserveQuota, saveQuotaState, finishQuotaAttempt, QuotaStoreError } from "./aiQuota.ts";

function memCfg(overrides = {}) {
  return { store: "memory", filePath: "", dailyGlobalFreeReq: 50, dailyPerUserFreeReq: 8, minutePerUserEcoScan: 2, minutePerUserEcoGuide: 4, ...overrides };
}

test("minute limits are independent per user and per feature", () => {
  const cfg = memCfg({ minutePerUserEcoScan: 1, minutePerUserEcoGuide: 2 });
  assert.deepEqual(reserveQuota(cfg, "user-a", "ecoscan"), { ok: true });
  assert.deepEqual(reserveQuota(cfg, "user-a", "ecoscan"), { ok: false, reason: "user_minute" });
  // EcoGuía uses its own bucket, so it is not blocked by the EcoScan limit.
  assert.deepEqual(reserveQuota(cfg, "user-a", "ecoguide"), { ok: true });
  assert.deepEqual(reserveQuota(cfg, "user-a", "ecoguide"), { ok: true });
  assert.deepEqual(reserveQuota(cfg, "user-a", "ecoguide"), { ok: false, reason: "user_minute" });
  // Another account keeps its own budget.
  assert.deepEqual(reserveQuota(cfg, "user-b", "ecoscan"), { ok: true });
});

test("file store fails closed on corrupted state or a competing process lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "ecopulse-quota-"));
  try {
    const cfg = memCfg({ store: "file", filePath: join(dir, "quota.json") });
    writeFileSync(cfg.filePath, "{invalid json");
    assert.throws(() => reserveQuota(cfg, "a", "ecoscan"), QuotaStoreError);
    rmSync(cfg.filePath);
    mkdirSync(cfg.filePath + ".lock");
    assert.throws(() => reserveQuota(cfg, "a", "ecoscan"), QuotaStoreError);
    rmSync(cfg.filePath + ".lock", { recursive: true });
    const reserved = reserveQuota(cfg, "a", "ecoscan", Date.now(), { model: "vision:free", number: 1 });
    assert.equal(reserved.ok, true);
    finishQuotaAttempt(cfg, reserved.attemptId, "503", 42, "ai_provider_unavailable");
    const state = loadQuotaState(cfg);
    assert.equal(state.globalDaily.c, 1);
    assert.equal(state.attempts.length, 1);
    assert.equal(state.attempts[0].status, "503");
    assert.equal(state.attempts[0].errorCode, "ai_provider_unavailable");
    assert.throws(() => finishQuotaAttempt(cfg, reserved.attemptId, "200", 1), QuotaStoreError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent processes cannot exceed a shared daily limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecopulse-quota-concurrent-"));
  try {
    const path = join(dir, "quota.json");
    const script = `import { reserveQuota } from './src/lib/aiQuota.ts';\n` +
      `const cfg = { store: 'file', filePath: process.argv[1], dailyGlobalFreeReq: 1, dailyPerUserFreeReq: 8, minutePerUserEcoScan: 2, minutePerUserEcoGuide: 4 };\n` +
      `try { process.stdout.write(reserveQuota(cfg, process.argv[2], 'ecoscan').ok ? 'ok' : 'blocked'); } catch { process.stdout.write('unavailable'); }`;
    const jobs = Array.from({ length: 4 }, (_, i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path, `user-${i}`],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`worker exited ${code}`)));
    }));
    const results = await Promise.all(jobs);
    assert.equal(results.filter((r) => r === "ok").length, 1);
    assert.equal(loadQuotaState(memCfg({ store: "file", filePath: path })).globalDaily.c, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("daily per-user and global limits block without partial state", () => {
  const cfg = memCfg({ dailyPerUserFreeReq: 2, dailyGlobalFreeReq: 3, minutePerUserEcoScan: 10, minutePerUserEcoGuide: 10 });
  assert.equal(reserveQuota(cfg, "user-a", "ecoscan").ok, true);
  assert.equal(reserveQuota(cfg, "user-a", "ecoguide").ok, true);
  assert.deepEqual(reserveQuota(cfg, "user-a", "ecoscan"), { ok: false, reason: "user_daily" });
  // The rejected reservation must not consume the global budget for others.
  assert.equal(reserveQuota(cfg, "user-b", "ecoscan").ok, true);
  assert.deepEqual(reserveQuota(cfg, "user-c", "ecoscan"), { ok: false, reason: "global_daily" });
});

test("file store persists counters, rolls over by day and caps attempts", () => {
  const dir = mkdtempSync(join(tmpdir(), "ecopulse-quota-"));
  try {
    const cfg = memCfg({ store: "file", filePath: join(dir, "ai_quota.json"), dailyPerUserFreeReq: 1, dailyGlobalFreeReq: 50, minutePerUserEcoScan: 10 });
    assert.equal(reserveQuota(cfg, "user-a", "ecoscan").ok, true);
    assert.deepEqual(reserveQuota(cfg, "user-a", "ecoscan"), { ok: false, reason: "user_daily" });
    // Counters survive a reload (same process, same file).
    const loaded = loadQuotaState(cfg);
    assert.equal(loaded.userDaily["user-a"].c, 1);
    assert.equal(loaded.globalDaily.c, 1);
    // A stale day resets the daily counters on load.
    saveQuotaState(cfg, { ...loaded, globalDaily: { d: "2000-01-01", c: 9 }, userDaily: { "user-a": { d: "2000-01-01", c: 9 } } });
    assert.equal(reserveQuota(cfg, "user-a", "ecoscan").ok, true);
    const next = loadQuotaState(cfg);
    assert.equal(next.globalDaily.c, 1);
    assert.equal(next.userDaily["user-a"].c, 1);
    // Attempt log is capped to the most recent 200 entries.
    for (let index = 0; index < 210; index += 1) recordAttempt(cfg, "user-a", "ecoscan", "test-model", 1, "ok");
    assert.equal(loadQuotaState(cfg).attempts.length, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
