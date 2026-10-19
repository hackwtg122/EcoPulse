import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const dbDir = path.dirname(fileURLToPath(import.meta.url));
const localEnvFile = path.resolve(dbDir, "../../.env.local");
if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  out: "./drizzle",
  ...(process.env.MIGRATION_DATABASE_URL
    ? { dbCredentials: { url: process.env.MIGRATION_DATABASE_URL } }
    : {}),
});
