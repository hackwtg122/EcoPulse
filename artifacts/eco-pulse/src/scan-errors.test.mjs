import assert from "node:assert/strict";
import test from "node:test";
import {
  ClassifyError,
  classifyErrorMessages,
  classifyMessage,
} from "./scan-errors.ts";

test("unknown server responses are not reported as network failures", () => {
  assert.equal(
    classifyMessage("unexpected_code", 0, 500),
    classifyErrorMessages.server_error,
  );
  assert.equal(
    classifyMessage("unexpected_code", 0, 503),
    classifyErrorMessages.server_error,
  );
  assert.equal(
    classifyMessage("unexpected_code", 0, 400),
    classifyErrorMessages.request_rejected,
  );
  assert.equal(
    classifyMessage("unexpected_code", 0, 403),
    classifyErrorMessages.request_rejected,
  );
  assert.equal(
    classifyMessage("unexpected_code", 0),
    classifyErrorMessages.network,
  );
});

test("known codes keep their concrete message and wait hint", () => {
  assert.equal(
    classifyMessage("ai_consent_required", 0, 403),
    classifyErrorMessages.ai_consent_required,
  );
  assert.equal(
    classifyMessage("ai_provider_model_not_verified", 0, 503),
    classifyErrorMessages.ai_provider_model_not_verified,
  );
  assert.equal(
    classifyMessage("ai_provider_invalid", 0, 500),
    classifyErrorMessages.ai_provider_invalid,
  );
  assert.equal(
    classifyMessage("ai_quota_minute", 30, 429),
    `${classifyErrorMessages.ai_quota_minute} Reintenta en 30 s.`,
  );
  assert.match(
    classifyMessage("ai_quota_minute", 600, 429),
    /Reintenta en ~10 min\.$/,
  );
});

test("ClassifyError preserves the HTTP status used for the fallback", () => {
  const error = new ClassifyError("unknown_code", 0, 502);
  assert.equal(error.code, "unknown_code");
  assert.equal(error.status, 502);
  assert.equal(
    classifyMessage(error.code, error.retryAfterSeconds, error.status),
    classifyErrorMessages.server_error,
  );
});
