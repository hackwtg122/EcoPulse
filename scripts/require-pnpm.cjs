const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm to install this workspace's dependencies.");
  process.exitCode = 1;
}
