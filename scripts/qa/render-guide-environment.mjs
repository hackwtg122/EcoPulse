// Narrow access to the existing official service. Never print configuration.
export async function renderGuideEnvironment() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "hackwtg122/EcoPulse" ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    throw new Error("official_runner_required");
  if (!process.env.RENDER_API_KEY) throw new Error("render_access_missing");
  async function request(path, body) {
    const response = await fetch(`https://api.render.com/v1${path}`, {
      method: body ? "PUT" : "GET",
      headers: {
        Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("render_read_failed");
    if (response.status === 204) return null;
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  async function pages(path) {
    const result = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const rows = await request(
        `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!Array.isArray(rows)) throw new Error("render_read_failed");
      result.push(...rows);
      if (rows.length < 100) return result;
      const next = rows.at(-1)?.cursor;
      if (!next || next === cursor) throw new Error("render_read_failed");
      cursor = next;
    }
    throw new Error("render_read_failed");
  }
  const services = (await pages("/services"))
    .map((row) => row.service)
    .filter(
      (service) =>
        service?.serviceDetails?.url?.replace(/\/$/, "") ===
          "https://ecopulse-3xb4.onrender.com" &&
        service.repo?.replace(/\.git$/, "") ===
          "https://github.com/hackwtg122/EcoPulse" &&
        service.branch === "main",
    );
  if (services.length !== 1) throw new Error("official_service_not_unique");
  const path = `/services/${encodeURIComponent(services[0].id)}/env-vars`;
  const env = {};
  for (const row of await pages(path))
    if (
      [
        "DATABASE_URL",
        "EVALUATION_DATABASE_URL",
        "EVALUATION_MODE_ENABLED",
        "GUIDE_DATABASE_URL",
      ].includes(row.envVar?.key)
    )
      env[row.envVar.key] = row.envVar.value;
  return {
    env,
    setGuideUrl: (value) => request(`${path}/GUIDE_DATABASE_URL`, { value }),
  };
}
