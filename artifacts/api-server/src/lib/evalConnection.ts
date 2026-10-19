import { pool } from "@workspace/db";

function getEvaluationDbName(): string {
  return process.env.EVALUATION_DB_NAME || "ecopulse_eval";
}

function isEvaluationMode(): boolean {
  return process.env.EVALUATION_MODE_ENABLED === "true";
}

export function getEvalDbName(): string {
  return getEvaluationDbName();
}

export function evalModeEnabled(): boolean {
  return isEvaluationMode();
}

export async function getEvalPool() {
  if (!isEvaluationMode()) throw new Error("Evaluation database is not enabled");
  return pool;
}
