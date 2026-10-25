const apiRoutes = /^\/(?:sign-in|sign-up|dashboard|progress|scan|map|deliveries|rewards|chat|profile|security|admin)(?:\/|$)/;

export function shouldWarmPilotApi(pathname: string, basePath = "") {
  const base = basePath.replace(/\/$/, "");
  const path = base && (pathname === base || pathname.startsWith(`${base}/`))
    ? pathname.slice(base.length) || "/"
    : pathname;
  return apiRoutes.test(path);
}

// Wake the API while Clerk initializes; this public health request sends no session or account data.
export function warmPilotApi(pathname: string, basePath: string, apiUrl: string, fetchImplementation: typeof fetch = fetch) {
  if (!shouldWarmPilotApi(pathname, basePath)) return;
  const base = apiUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) return;
  void fetchImplementation(`${base}/api/healthz`, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
  }).catch(() => {
    // The authenticated requests still run normally if warmup fails.
  });
}
