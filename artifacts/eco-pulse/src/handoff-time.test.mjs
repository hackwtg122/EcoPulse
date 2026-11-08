import assert from "node:assert/strict";
import test from "node:test";
import { defaultHandoffDateTime, minimumHandoffDateTime, handoffDateTimeError, localDateTimeValue } from "./handoff-time.ts";

test("handoff default is a local future datetime, not an empty or expired value", () => {
  const now = new Date("2026-11-08T04:58:00Z");
  const input = defaultHandoffDateTime(now);
  assert.ok(input.length === 16);
  assert.ok(new Date(input).getTime() > now.getTime() + 5 * 60_000);
  assert.equal(handoffDateTimeError(input, now), null);
  assert.ok(new Date(minimumHandoffDateTime(now)) > now);
});
test("expired previous proposal is replaced with future default", () => {
  const now = new Date("2026-11-08T04:58:00Z");
  const expired = new Date("2026-11-07T18:58:00Z");
  assert.notEqual(defaultHandoffDateTime(now, expired), localDateTimeValue(expired));
  assert.equal(handoffDateTimeError(defaultHandoffDateTime(now, expired), now), null);
});
test("valid future proposal survives edit", () => {
  const now = new Date("2026-11-08T04:58:00Z");
  const future = new Date(now.getTime() + 2 * 60 * 60_000);
  assert.equal(defaultHandoffDateTime(now, future), localDateTimeValue(future));
});
test("validation distinguishes missing, past, near and too-far dates", () => {
  const now = new Date("2026-11-08T04:58:00Z");
  assert.match(handoffDateTimeError("", now) ?? "", /Selecciona/);
  assert.match(handoffDateTimeError("2026-11-07T13:58", now) ?? "", /pasó|cerca/);
  assert.match(handoffDateTimeError(localDateTimeValue(new Date(now.getTime() + 2 * 60_000)), now) ?? "", /cerca/);
  assert.match(handoffDateTimeError(localDateTimeValue(new Date(now.getTime() + 181 * 86400000)), now) ?? "", /180 días/);
});
