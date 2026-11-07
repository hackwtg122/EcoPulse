import assert from "node:assert/strict";
import test from "node:test";
import { percentile, summarize } from "./concurrency-20.mjs";

test("percentiles use nearest-rank and ignore order", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
});

test("summary separates rate limits, server failures and network errors", () => {
  const records = [
    { ms: 10, status: 200 }, { ms: 20, status: 200 }, { ms: 30, status: 429 },
    { ms: 40, status: 503 }, { ms: 50, status: null }, { ms: 60, status: 200 },
  ];
  const summary = summarize(records, 60000);
  assert.equal(summary.requests, 6);
  assert.equal(summary.rateLimited, 1);
  assert.equal(summary.serverErrors, 1);
  assert.equal(summary.networkErrors, 1);
  assert.deepEqual(summary.byStatus, { 200: 3, 429: 1, 503: 1 });
  assert.equal(summary.p50Ms, 30);
  assert.equal(summary.p95Ms, 60);
  assert.equal(summary.maxMs, 60);
  assert.equal(summary.wallSeconds, 60);
});

test("an empty run reports null percentiles instead of zero latency", () => {
  const summary = summarize([], 30000);
  assert.equal(summary.requests, 0);
  assert.equal(summary.p50Ms, null);
  assert.equal(summary.p95Ms, null);
  assert.equal(summary.maxMs, null);
  assert.equal(summary.requestsPerSecond, 0);
});
