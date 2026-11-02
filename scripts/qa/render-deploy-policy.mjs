export const LIVE_TIMEOUT_MS = 20 * 60 * 1000;
const failed = new Set(["build_failed", "pre_deploy_failed", "update_failed", "failed", "canceled", "cancelled", "deactivated"]);
const active = new Set(["created", "queued", "build_in_progress", "pre_deploy_in_progress", "update_in_progress", "live"]);

export function reusableDeploy(rows, sha) {
  if (!Array.isArray(rows)) throw new Error("invalid_render_deploy_listing");
  return rows.map(row => row.deploy ?? row).find(deploy => deploy.commit?.id === sha && active.has(deploy.status));
}

export async function waitForLive({ read, sha, now = Date.now, sleep, timeoutMs = LIVE_TIMEOUT_MS, onStatus = () => {} }) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    let state;
    try { state = await read(Math.min(30000, deadline - now())); }
    catch (error) {
      if (![429, 500, 502, 503, 504].includes(error.status) && error.name !== "TimeoutError") throw error;
      onStatus("transient_api_error");
    }
    if (state) {
      onStatus(state.status);
      if (failed.has(state.status)) throw new Error(`render_deploy_${state.status}`);
      if (state.status === "live") {
        if (state.commit?.id !== sha) throw new Error("render_live_commit_mismatch");
        return state;
      }
    }
    if (now() < deadline) await sleep(Math.min(15000, deadline - now()));
  }
  throw new Error("render_deploy_live_timeout_20_minutes");
}

export async function verifyRuntime({ sha, fetchImpl = fetch, now = Date.now, sleep, timeoutMs = 120000 }) {
  const deadline = now() + timeoutMs;
  let last = "unavailable";
  while (now() < deadline) {
    try {
      const options = { headers: { "Cache-Control": "no-cache" }, redirect: "error", signal: AbortSignal.timeout(Math.min(15000, deadline - now())) };
      const [health, version] = await Promise.all([
        fetchImpl(`https://ecopulse-3xb4.onrender.com/api/healthz?deploy=${sha}`, options),
        fetchImpl(`https://ecopulse-3xb4.onrender.com/api/version?deploy=${sha}`, options),
      ]);
      last = `health_${health.status}_version_${version.status}`;
      if (health.status === 200 && version.status === 200) {
        const [h, v] = await Promise.all([health.json(), version.json()]);
        if (h.status === "ok" && v.service === "ecopulse-api" && v.commit === sha) return;
        last = "runtime_commit_or_service_mismatch";
      }
    } catch { last = "runtime_response_unavailable"; }
    if (now() < deadline) await sleep(Math.min(10000, deadline - now()));
  }
  throw new Error(`render_live_but_runtime_not_verified_${last}`);
}
