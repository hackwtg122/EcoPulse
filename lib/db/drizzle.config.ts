import { defineConfig } from "drizzle-kit";
import path from "path";
import { fileURLToPath } from "node:url";

const dbDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: path.join(dbDir, "./src/schema/index.ts"),
  dialect: "postgresql",
  out: path.join(dbDir, "./drizzle"),
  ...(process.env.DATABASE_URL ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
