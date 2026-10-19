import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error(".env.local does not exist");
process.loadEnvFile(envFile);

const publishable = process.env.CLERK_PUBLISHABLE_KEY;
const vitePublishable = process.env.VITE_CLERK_PUBLISHABLE_KEY;
const secret = process.env.CLERK_SECRET_KEY;
const origins = process.env.PILOT_ALLOWED_ORIGINS;
const proxy = process.env.VITE_CLERK_PROXY_URL;

if (!/^pk_test_[A-Za-z0-9_-]+$/.test(publishable ?? "")) {
  throw new Error("CLERK_PUBLISHABLE_KEY is missing or is not a Development key");
}
if (vitePublishable !== publishable) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY must equal CLERK_PUBLISHABLE_KEY");
}
if (!/^sk_test_[A-Za-z0-9_-]+$/.test(secret ?? "")) {
  throw new Error("CLERK_SECRET_KEY is missing or is not a Development key");
}
if (origins !== "http://127.0.0.1:5174") {
  throw new Error("PILOT_ALLOWED_ORIGINS must be exactly http://127.0.0.1:5174 for local development");
}
if (proxy?.trim()) {
  throw new Error("VITE_CLERK_PROXY_URL must remain empty for local development");
}

console.log(JSON.stringify({
  environment: "development",
  publishableKeysMatch: true,
  secretKeyPresent: true,
  allowedOrigins: [origins],
  clerkProxyEnabled: false,
  credentialsPrinted: false,
}, null, 2));
