import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Refuse a stale/cached bundle rather than let an old healthy API masquerade as
// the new deployment. No database or remote call is made by this preflight.
const bundleUrl = new URL("./dist/index.mjs", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("./dist/build-info.json", import.meta.url), "utf8"));
const bundle = await readFile(bundleUrl);
if (!/^[a-f0-9]{40}$/i.test(manifest.commit) || createHash("sha256").update(bundle).digest("hex") !== manifest.bundleSha256) {
  throw new Error("API build manifest/bundle mismatch; rebuild the intended source");
}
if (process.env.RENDER_GIT_COMMIT && manifest.commit !== process.env.RENDER_GIT_COMMIT) {
  throw new Error("API build commit differs from Render deployment commit");
}
console.log(JSON.stringify({ check: "api_start_verified_bundle", commit: manifest.commit }));
await import(bundleUrl.href);
