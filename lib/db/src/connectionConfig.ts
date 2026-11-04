/** Select exactly one database for the lifetime of the API process. */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
): string {
  const primary = env.DATABASE_URL;
  if (env.EVALUATION_MODE_ENABLED !== "true") {
    if (!primary) throw new Error("DATABASE_URL must be set");
    return primary;
  }

  const evaluation = env.EVALUATION_DATABASE_URL;
  if (!primary || !evaluation) {
    throw new Error(
      "Evaluation requires DATABASE_URL and EVALUATION_DATABASE_URL",
    );
  }
  let primaryUrl: URL;
  let evaluationUrl: URL;
  try {
    primaryUrl = new URL(primary);
    evaluationUrl = new URL(evaluation);
  } catch {
    throw new Error("Invalid database URL for evaluation");
  }
  if (
    !["postgres:", "postgresql:"].includes(evaluationUrl.protocol) ||
    evaluationUrl.pathname !== "/ecopulse_eval" ||
    evaluationUrl.href === primaryUrl.href ||
    primaryUrl.pathname === evaluationUrl.pathname
  ) {
    throw new Error(
      "Evaluation database must be an independent ecopulse_eval connection",
    );
  }
  return evaluation;
}

/** Guide storage must never fall back to the owner's RLS-bypassing pool. */
export function resolveGuideDatabaseUrl(
  env: Record<string, string | undefined>,
): string {
  let guide: URL;
  let primary: URL;
  try {
    guide = new URL(env.GUIDE_DATABASE_URL || "");
    primary = new URL(resolveDatabaseUrl(env));
  } catch {
    throw new Error("guide_storage_configuration_required");
  }
  if (
    !["postgres:", "postgresql:"].includes(guide.protocol) ||
    !guide.hostname.endsWith(".neon.tech") ||
    guide.pathname !== "/neondb" ||
    guide.hostname !== primary.hostname ||
    guide.port !== primary.port ||
    guide.pathname !== primary.pathname ||
    decodeURIComponent(guide.username) !== "ecopulse_guide_runtime" ||
    !guide.password
  ) {
    throw new Error("guide_storage_configuration_required");
  }
  guide.searchParams.set("sslmode", "verify-full");
  return guide.href;
}
