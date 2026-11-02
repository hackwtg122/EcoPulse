// Read-only remote configuration check, not login/session E2E. No user reads,
// sessions, sign-in tokens, account creation or credential logging.
if (process.env.GITHUB_ACTIONS !== "true" && !process.argv.includes("--direct-clerk-inspection")) throw new Error("remote_inspection_required");
if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(process.env.CLERK_SECRET_KEY || "")) throw new Error("configured_clerk_secret_required");
try {
  const htmlResponse = await fetch("https://ecopulseef.netlify.app", { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!htmlResponse.ok) throw new Error("frontend_unavailable");
  const html = await htmlResponse.text();
  const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (!asset) throw new Error("frontend_entry_missing");
  const bundle = await fetch(new URL(asset[1], "https://ecopulseef.netlify.app"), { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!bundle.ok) throw new Error("frontend_bundle_unavailable");
  const publishable = (await bundle.text()).match(/pk_(test|live)_([A-Za-z0-9]+)/);
  if (!publishable) throw new Error("frontend_clerk_key_not_detected");
  const domain = Buffer.from(publishable[2], "base64").toString("utf8").replace(/\$$/, "");
  if (!/^[a-z0-9-]+\.clerk\.accounts\.dev$/.test(domain)) throw new Error("unrecognized_clerk_instance_domain");
  const [publicJwks, privateJwks] = await Promise.all([
    fetch(`https://${domain}/.well-known/jwks.json`, { signal: AbortSignal.timeout(30000), redirect: "error" }),
    fetch("https://api.clerk.com/v1/jwks", { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` }, signal: AbortSignal.timeout(30000), redirect: "error" }),
  ]);
  if (!publicJwks.ok || !privateJwks.ok) throw new Error(`clerk_jwks_http_${publicJwks.status}_${privateJwks.status}`);
  const a = (await publicJwks.json()).keys;
  const b = (await privateJwks.json()).keys;
  const match = Array.isArray(a) && Array.isArray(b) && a.some(x => b.some(y => x.kid === y.kid && x.n === y.n && x.e === y.e));
  console.log(JSON.stringify({ check: "local_secret_vs_deployed_frontend_clerk_instance", status: match ? "PASS" : "FAIL", instanceKind: publishable[1], scope: "configuration_only_not_Render_secret_or_login" }));
  if (!match) process.exitCode = 1;
} catch (error) {
  // Only our fixed error codes are emitted; never remote payloads.
  const message = /^[a-z0-9_]+$/.test(error?.message || "") ? error.message : "clerk_inspection_failed";
  console.log(JSON.stringify({ check: "clerk_instance_inspection", status: "BLOCKED", reason: message }));
  process.exitCode = 1;
}
