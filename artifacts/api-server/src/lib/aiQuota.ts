import { readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type QuotaConfig = {
  store: "file" | "memory";
  filePath: string;
  dailyGlobalFreeReq: number;
  dailyPerUserFreeReq: number;
  minutePerUserEcoScan: number;
  minutePerUserEcoGuide: number;
  /**
   * Age after which a lock file left behind by a killed process (SIGKILL on
   * deploys/restarts) is considered stale and reclaimed. A request holds the
   * lock for a few milliseconds, so this only ever matches abandoned locks.
   * Defaults to 120000 ms.
   */
  lockStaleMs?: number;
};

export class QuotaStoreError extends Error {
  constructor() { super("ai_quota_store_unavailable"); }
}

export type QuotaState = {
  globalDaily: { d: string; c: number };
  userDaily: Record<string, { d: string; c: number }>;
  userMinuteEcoScan: Record<string, { m: string; c: number }>;
  userMinuteEcoGuide: Record<string, { m: string; c: number }>;
  attempts: Array<{ id: string; userId: string; endpoint: string; model: string; attempt: number; status: string; errorCode?: string; durationMs?: number; createdAt: string }>;
};

export type QuotaCheck = { ok: boolean; reason?: "global_daily" | "user_daily" | "user_minute" | "concurrent"; attemptId?: string };

const nowUtc = () => new Date();
const dayUtc = (d: Date) => d.toISOString().slice(0, 10);
const minuteUtc = (d: Date) => d.toISOString().slice(0, 16).replace("T", "-");

// In-process quota state for store:"memory". Keyed by the config object so each
// independent configuration (tests, multiple servers) keeps its own counters.
const memoryStates = new WeakMap<QuotaConfig, QuotaState>();

function clamp(n: number, def: number): number {
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.floor(n);
}

export function loadQuotaState(cfg: QuotaConfig): QuotaState {
  const d = dayUtc(nowUtc());
  const m = minuteUtc(nowUtc());
  const base: QuotaState = {
    globalDaily: { d, c: 0 },
    userDaily: {},
    userMinuteEcoScan: {},
    userMinuteEcoGuide: {},
    attempts: [],
  };
  if (cfg.store !== "file") {
    const state = memoryStates.get(cfg) ?? base;
    if (state.globalDaily.d !== d) state.globalDaily = { d, c: 0 };
    for (const [k, v] of Object.entries(state.userDaily)) if (v.d !== d) delete state.userDaily[k];
    for (const [k, v] of Object.entries(state.userMinuteEcoScan)) if (v.m !== m) delete state.userMinuteEcoScan[k];
    for (const [k, v] of Object.entries(state.userMinuteEcoGuide)) if (v.m !== m) delete state.userMinuteEcoGuide[k];
    return state;
  }
  try {
    const raw = readFileSync(cfg.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<QuotaState>;
    if (!parsed || !parsed.globalDaily || !Number.isSafeInteger(parsed.globalDaily.c) || parsed.globalDaily.c < 0 ||
        typeof parsed.globalDaily.d !== "string" || !parsed.userDaily || !parsed.userMinuteEcoScan || !parsed.userMinuteEcoGuide ||
        !Array.isArray(parsed.attempts)) throw new QuotaStoreError();
    const s: QuotaState = { ...base, ...parsed };
    if (s.globalDaily.d !== d) s.globalDaily = { d, c: 0 };
    for (const [k, v] of Object.entries(s.userDaily)) if (v.d !== d) delete s.userDaily[k];
    for (const [k, v] of Object.entries(s.userMinuteEcoScan)) if (v.m !== m) delete s.userMinuteEcoScan[k];
    for (const [k, v] of Object.entries(s.userMinuteEcoGuide)) if (v.m !== m) delete s.userMinuteEcoGuide[k];
    if (!Array.isArray(s.attempts)) s.attempts = [];
    s.attempts = s.attempts.slice(-200);
    return s;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return base;
    throw new QuotaStoreError();
  }
}

export function saveQuotaState(cfg: QuotaConfig, s: QuotaState): void {
  if (cfg.store !== "file") {
    memoryStates.set(cfg, s);
    return;
  }
  try {
    mkdirSync(dirname(cfg.filePath), { recursive: true });
    const tmp = cfg.filePath + `.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 0));
    renameSync(tmp, cfg.filePath);
  } catch {
    throw new QuotaStoreError();
  }
}

// An exclusive directory works across Node processes on this local filesystem.
// Hosts that kill the process without running cleanup (Render deploys, OOM,
// SIGKILL) leave the directory behind: reclaim only locks older than any
// plausible request, so a live or fresh lock still fails closed.
function withQuotaLock<T>(cfg: QuotaConfig, action: () => T): T {
  if (cfg.store === "memory") return action();
  const lock = cfg.filePath + ".lock";
  try {
    mkdirSync(dirname(cfg.filePath), { recursive: true });
  } catch {
    throw new QuotaStoreError();
  }
  if (!tryAcquireLock(lock)) {
    const staleMs = clamp(cfg.lockStaleMs ?? 120_000, 120_000);
    let stale = false;
    try {
      stale = Date.now() - statSync(lock).mtimeMs > staleMs;
    } catch {
      stale = false;
    }
    if (stale) {
      try { rmdirSync(lock); } catch { /* another process may have released it first */ }
    }
    if (!tryAcquireLock(lock)) throw new QuotaStoreError();
  }
  try { return action(); }
  finally { try { rmdirSync(lock); } catch { /* stale lock fails closed */ } }
}

function tryAcquireLock(lock: string): boolean {
  try {
    mkdirSync(lock);
    return true;
  } catch {
    return false;
  }
}

function ensureMinuteBucket(s: QuotaState, key: "userMinuteEcoScan" | "userMinuteEcoGuide", userId: string, m: string): void {
  if (!s[key][userId] || s[key][userId].m !== m) {
    s[key][userId] = { m, c: 0 };
  }
}

function ensureDailyUser(s: QuotaState, userId: string, d: string): void {
  if (!s.userDaily[userId] || s.userDaily[userId].d !== d) {
    s.userDaily[userId] = { d, c: 0 };
  }
}

// Atomic reservation: check all limits (global daily + user daily + user minute) and increment all counters.
// If any check fails, throw error without incrementing anything. Persist state.
export function reserveQuota(
  cfg: QuotaConfig,
  userId: string,
  kind: "ecoscan" | "ecoguide",
  now: number = Date.now(),
  attempt?: { model: string; number: number },
): QuotaCheck {
  return withQuotaLock(cfg, () => reserveQuotaLocked(cfg, userId, kind, now, attempt));
}

function reserveQuotaLocked(
  cfg: QuotaConfig, userId: string, kind: "ecoscan" | "ecoguide", now: number,
  attempt?: { model: string; number: number },
): QuotaCheck {
  const state = loadQuotaState(cfg);
  const d = dayUtc(new Date(now));
  const m = minuteUtc(new Date(now));

  const gl = clamp(cfg.dailyGlobalFreeReq, 50);
  if (state.globalDaily.d !== d) state.globalDaily = { d, c: 0 };
  if (state.globalDaily.c >= gl) return { ok: false, reason: "global_daily" };

  const ul = clamp(cfg.dailyPerUserFreeReq, 8);
  ensureDailyUser(state, userId, d);
  if (state.userDaily[userId].c >= ul) return { ok: false, reason: "user_daily" };

  const mlKey = kind === "ecoscan" ? "userMinuteEcoScan" : "userMinuteEcoGuide";
  const ml = clamp(kind === "ecoscan" ? cfg.minutePerUserEcoScan : cfg.minutePerUserEcoGuide, kind === "ecoscan" ? 2 : 4);
  ensureMinuteBucket(state, mlKey, userId, m);
  if (state[mlKey][userId].c >= ml) return { ok: false, reason: "user_minute" };

  state.globalDaily.c += 1;
  state.userDaily[userId].c += 1;
  state[mlKey][userId].c += 1;
  const attemptId = attempt ? randomUUID() : undefined;
  if (attemptId && attempt) state.attempts.push({ id: attemptId, userId, endpoint: kind, model: attempt.model,
    attempt: attempt.number, status: "reserved", createdAt: new Date(now).toISOString() });
  if (state.attempts.length > 200) state.attempts = state.attempts.slice(-200);
  saveQuotaState(cfg, state);
  return attemptId ? { ok: true, attemptId } : { ok: true };
}

export function finishQuotaAttempt(cfg: QuotaConfig, id: string, status: string, durationMs: number, errorCode?: string): void {
  withQuotaLock(cfg, () => {
    const state = loadQuotaState(cfg);
    const entry = state.attempts.find((row) => row.id === id);
    // The audit row can disappear when the store is reset (host restart) or the
    // capped log rotates. Closing it is bookkeeping: never turn a real analysis
    // into an error because the row is gone.
    if (!entry) return;
    if (entry.status !== "reserved") throw new QuotaStoreError();
    entry.status = status;
    entry.durationMs = durationMs;
    if (errorCode) entry.errorCode = errorCode;
    saveQuotaState(cfg, state);
  });
}

// Record attempt (for audit, incl. retries and failures)
export function recordAttempt(
  cfg: QuotaConfig,
  userId: string,
  endpoint: string,
  model: string,
  attempt: number,
  status: string,
  errorCode?: string,
  durationMs?: number,
): void {
  withQuotaLock(cfg, () => recordAttemptLocked(cfg, userId, endpoint, model, attempt, status, errorCode, durationMs));
}

function recordAttemptLocked(
  cfg: QuotaConfig, userId: string, endpoint: string, model: string, attempt: number,
  status: string, errorCode?: string, durationMs?: number,
): void {
  const state = loadQuotaState(cfg);
  state.attempts.push({
    id: randomUUID(),
    userId,
    endpoint,
    model,
    attempt,
    status,
    errorCode,
    durationMs,
    createdAt: nowUtc().toISOString(),
  });
  if (state.attempts.length > 200) state.attempts = state.attempts.slice(-200);
  saveQuotaState(cfg, state);
}
