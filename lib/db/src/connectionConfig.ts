/** Select exactly one database for the lifetime of the API process. */
export function resolveDatabaseUrl(env: Record<string, string | undefined>): string {
  const primary = env.DATABASE_URL;
  if (env.EVALUATION_MODE_ENABLED !== "true") {
    if (!primary) throw new Error("DATABASE_URL must be set");
    return primary;
  }

  const evaluation = env.EVALUATION_DATABASE_URL;
  if (!primary || !evaluation) {
    throw new Error("Evaluation requires DATABASE_URL and EVALUATION_DATABASE_URL");
  }
  let primaryUrl: URL;
  let evaluationUrl: URL;
  try {
    primaryUrl = new URL(primary);
    evaluationUrl = new URL(evaluation);
  } catch {
    throw new Error("Invalid database URL for evaluation");
  }
  if (!["postgres:", "postgresql:"].includes(evaluationUrl.protocol) ||
      evaluationUrl.pathname !== "/ecopulse_eval" ||
      evaluationUrl.href === primaryUrl.href ||
      primaryUrl.pathname === evaluationUrl.pathname) {
    throw new Error("Evaluation database must be an independent ecopulse_eval connection");
  }
  return evaluation;
}
