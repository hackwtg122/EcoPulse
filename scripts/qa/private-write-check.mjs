// Executed in the verified test account's browser. Never return credentials or IDs.
export async function reversibleFavoriteCheck(api) {
  let id = null;
  let attempted = false;
  let cleaned = false;
  let result = "FAIL";
  try {
    const token = await window.Clerk?.session?.getToken();
    if (!token) return { status: "BLOCKED", reason: "session_unavailable" };
    const call = (path, method = "GET") => fetch(`${api}/api/pilot/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}), cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30000),
    });
    const [favoritesResponse, centersResponse] = await Promise.all([call("favorites"), call("delivery-points")]);
    if (!favoritesResponse.ok || !centersResponse.ok) return { status: "BLOCKED", reason: "favorite_prerequisites_unavailable" };
    const favorites = await favoritesResponse.json(), centers = await centersResponse.json();
    if (!favorites.enabled || !Array.isArray(favorites.ids) || favorites.ids.length >= 100 || !Array.isArray(centers.points)) return { status: "BLOCKED", reason: "favorite_prerequisites_unavailable" };
    const candidate = centers.points.find(point => typeof point.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(point.id) && !favorites.ids.includes(point.id));
    if (!candidate) return { status: "BLOCKED", reason: "unused_published_center_unavailable" };
    id = candidate.id;
    try {
      attempted = true;
      const created = await call(`favorites/${id}`, "POST");
      if (created.status === 200) attempted = false; // Another action already owned it; never remove it.
      if (created.status === 201) {
        const read = await call("favorites");
        const data = read.ok ? await read.json() : null;
        result = data?.ids?.includes(id) ? "PASS" : "FAIL";
      }
    } finally {
      if (attempted) {
        const removed = await call(`favorites/${id}`, "DELETE").catch(() => null);
        const read = await call("favorites").catch(() => null);
        const data = read?.ok ? await read.json().catch(() => null) : null;
        cleaned = removed?.status === 204 && Array.isArray(data?.ids) && !data.ids.includes(id);
      }
    }
    return { status: result === "PASS" && cleaned ? "PASS" : "FAIL", reason: cleaned ? undefined : "favorite_cleanup_unconfirmed" };
  } catch {
    return { status: "FAIL", reason: attempted && !cleaned ? "favorite_cleanup_unconfirmed" : "favorite_check_failed" };
  }
}
