import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localEnvFile = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile);
}

const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: process.env.PORT || "5000",
};

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Process stopped by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
  });
}

await run(["./build.mjs"]);
await run(["--enable-source-maps", "./dist/index.mjs"]);
