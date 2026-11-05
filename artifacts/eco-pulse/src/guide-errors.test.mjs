import assert from "node:assert/strict";
import test from "node:test";
import { GuideApiError, guideQuotaMessages } from "./guide-api.ts";
import {
  guideErrorMessage,
  guideErrorMessages,
  guideRetryable,
} from "./guide-errors.ts";
import { retryWaitSuffix } from "./pilot-api.ts";

test("validation and session errors are explained without a blind retry", () => {
  for (const code of [
    "sensitive_guide_content",
    "invalid_guide_question",
    "invalid_guide_history",
    "unexpected_fields",
    "invalid_idempotency_key",
  ]) {
    const error = new GuideApiError(400, code);
    assert.equal(guideErrorMessage(error), guideErrorMessages[code]);
    assert.equal(guideRetryable(error), false);
  }
  assert.equal(
    guideRetryable(new GuideApiError(401, "authentication_required")),
    false,
  );
  assert.equal(
    guideRetryable(new GuideApiError(404, "conversation_not_found")),
    false,
  );
  assert.equal(
    guideRetryable(new GuideApiError(409, "conversation_limit_reached")),
    false,
  );
  assert.equal(
    guideRetryable(new GuideApiError(409, "conversation_turn_limit_reached")),
    false,
  );
});

test("transient storage, provider and quota failures remain retryable", () => {
  for (const error of [
    new GuideApiError(409, "guide_conversation_busy"),
    new GuideApiError(409, "guide_turn_changed"),
    new GuideApiError(502, "invalid_stored_guide_answer"),
    new GuideApiError(503, "guide_storage_unavailable"),
    new GuideApiError(503, "ai_provider_unavailable"),
    new GuideApiError(502, "invalid_conversation_response"),
    new GuideApiError(429, "ai_quota_daily", 120),
  ]) {
    assert.equal(guideRetryable(error), true, error.code);
    assert.ok(guideErrorMessage(error).length > 20, error.code);
  }
  assert.equal(guideRetryable(new TypeError("fetch failed")), true);
});

test("quota messages keep the concrete code and the advertised wait", () => {
  const error = new GuideApiError(429, "ai_quota_daily", 120);
  assert.equal(
    guideErrorMessage(error),
    `${guideQuotaMessages.ai_quota_daily}${retryWaitSuffix(120)}`,
  );
  assert.match(guideErrorMessage(error), /Reintenta en ~2 min\.$/);
});
