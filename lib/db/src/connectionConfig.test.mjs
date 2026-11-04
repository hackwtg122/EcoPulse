import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDatabaseUrl,
  resolveGuideDatabaseUrl,
} from "./connectionConfig.ts";

const dev = "postgresql://app:secret@localhost:5432/ecopulse_dev";
const evaluation = "postgresql://eval:secret@localhost:5432/ecopulse_eval";

test("default process selects the configured database", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: dev }), dev);
});

test("evaluation selects only the independent database", () => {
  assert.equal(
    resolveDatabaseUrl({
      DATABASE_URL: dev,
      EVALUATION_DATABASE_URL: evaluation,
      EVALUATION_MODE_ENABLED: "true",
    }),
    evaluation,
  );
});

test("evaluation fails closed when unconfigured or targeting primary", () => {
  for (const target of [
    undefined,
    dev,
    "postgresql://app:secret@localhost:5432/ecopulse_dev",
    "postgresql://app:secret@localhost:5432/other",
  ]) {
    assert.throws(() =>
      resolveDatabaseUrl({
        DATABASE_URL: dev,
        EVALUATION_DATABASE_URL: target,
        EVALUATION_MODE_ENABLED: "true",
      }),
    );
  }
});

test("guide storage never falls back to the main or local connection", () => {
  for (const env of [
    {},
    { DATABASE_URL: dev },
    { DATABASE_URL: dev, GUIDE_DATABASE_URL: dev },
    { DATABASE_URL: dev, GUIDE_DATABASE_URL: evaluation },
  ]) {
    assert.throws(
      () => resolveGuideDatabaseUrl(env),
      (error) => error.message === "guide_storage_configuration_required",
    );
  }
});
