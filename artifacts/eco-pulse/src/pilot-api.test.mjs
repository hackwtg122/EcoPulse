import assert from "node:assert/strict";
import test from "node:test";
import { createDetailedPilotDelivery, createPilotDelivery, createPilotScan, isCurrentPilotResponse, loadPilotDashboardData, loadPilotDeliveryOptions, loadPilotProgress, loadPilotPublicPoints, loadVerifierDeliveryQueue, loadVerifierCapabilities, loadPilotDeliveryEvents, receivePilotDelivery, verifyPilotDelivery, PilotApiError } from "./pilot-api.ts";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("loads and minimizes the authenticated dashboard snapshot", async () => {
  const bodies = {
    me: { id: "user-a", role: "participant" },
    balance: { balance: 0 },
    scans: [{ id: "scan-a", userId: "user-a", category: "paper", source: "manual", createdAt: "2026-10-10T00:00:00Z" }],
    deliveries: [{ id: "delivery-a", userId: "user-a", status: "pending", createdAt: "2026-10-10T00:00:00Z" }],
    redemptions: [{ id: "redemption-a", userId: "user-a", rewardId: "reward-a", cost: 10, idempotencyKey: "secret", createdAt: "2026-10-10T00:00:00Z" }],
  };
  const seenAuthorization = [];
  const fakeFetch = async (url, options) => {
    seenAuthorization.push(options.headers.Authorization);
    const endpoint = String(url).split("/").at(-1);
    return response(bodies[endpoint]);
  };
  const snapshot = await loadPilotDashboardData("http://127.0.0.1:5000", "session-token", new AbortController().signal, fakeFetch);
  assert.equal(snapshot.accountId, "user-a");
  assert.equal(snapshot.balance, 0);
  assert.deepEqual(snapshot.scans[0], { id: "scan-a", category: "paper", source: "manual", createdAt: "2026-10-10T00:00:00Z" });
  assert.equal("userId" in snapshot.scans[0], false);
  assert.equal("idempotencyKey" in snapshot.redemptions[0], false);
  assert.ok(seenAuthorization.every((value) => value === "Bearer session-token"));
});

test("surfaces authentication and server failures without retaining data", async () => {
  const fakeFetch = async () => response({ error: "authentication_required" }, 401);
  await assert.rejects(
    loadPilotDashboardData("http://127.0.0.1:5000", "expired", new AbortController().signal, fakeFetch),
    (error) => error instanceof PilotApiError && error.status === 401,
  );
});

test("rejects stale responses and responses from a previous account", () => {
  assert.equal(isCurrentPilotResponse(2, 1, "user-b", "user-a"), false);
  assert.equal(isCurrentPilotResponse(2, 2, "user-b", "user-a"), false);
  assert.equal(isCurrentPilotResponse(2, 2, "user-b", "user-b"), true);
});

test("creates a manual scan with a server-safe payload and idempotency key", async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return response({
      id: "00000000-0000-5000-8000-000000000001",
      userId: "user-a",
      category: "glass",
      source: "manual",
      createdAt: "2026-10-10T00:00:00Z",
    }, 201);
  };
  const scan = await createPilotScan(
    "http://127.0.0.1:5000",
    "session-token",
    "glass",
    "scan_operation_123",
    new AbortController().signal,
    fakeFetch,
  );
  assert.deepEqual(scan, {
    id: "00000000-0000-5000-8000-000000000001",
    category: "glass",
    source: "manual",
    createdAt: "2026-10-10T00:00:00Z",
  });
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer session-token");
  assert.equal(request.options.headers["Idempotency-Key"], "scan_operation_123");
  assert.deepEqual(JSON.parse(request.options.body), { category: "glass" });
  assert.equal("userId" in scan, false);
});

test("does not accept invented scan categories or sources from the API", async () => {
  const invalidCategory = async () => response({ id: "scan", category: "battery", source: "manual", createdAt: "now" }, 201);
  const invalidSource = async () => response({ id: "scan", category: "paper", source: "ai", createdAt: "now" }, 201);
  await assert.rejects(
    createPilotScan("http://127.0.0.1:5000", "token", "paper", "scan_operation_123", new AbortController().signal, invalidCategory),
    (error) => error instanceof PilotApiError && error.status === 502,
  );
  await assert.rejects(
    createPilotScan("http://127.0.0.1:5000", "token", "paper", "scan_operation_123", new AbortController().signal, invalidSource),
    (error) => error instanceof PilotApiError && error.status === 502,
  );
});


test("creates an idempotent pending delivery without accepting owner data", async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      id: "00000000-0000-5000-8000-000000000002",
      userId: "must-not-reach-ui",
      status: "pending",
      createdAt: "2026-10-14T12:00:00.000Z",
    }), {
      status: 200,
      headers: { "content-type": "application/json", "Idempotency-Replayed": "true" },
    });
  };
  const result = await createPilotDelivery(
    "http://127.0.0.1:5000",
    "session-token",
    "delivery_operation_123",
    new AbortController().signal,
    fakeFetch,
  );
  assert.deepEqual(result, {
    delivery: {
      id: "00000000-0000-5000-8000-000000000002",
      status: "pending",
      requestVersion: 1,
      createdAt: "2026-10-14T12:00:00.000Z",
      updatedAt: "2026-10-14T12:00:00.000Z",
      deliveryPoint: null,
      slot: null,
      materials: [],
    },
    replayed: true,
  });
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer session-token");
  assert.equal(request.options.headers["Idempotency-Key"], "delivery_operation_123");
  assert.deepEqual(JSON.parse(request.options.body), {});
  assert.equal("userId" in result.delivery, false);
});

test("loads a paginated verifier queue without retaining account identifiers", async () => {
  let requestUrl;
  const fakeFetch = async (url, options) => {
    requestUrl = String(url);
    assert.equal(options.headers.Authorization, "Bearer verifier-token");
    return response({
      items: [{
        id: "00000000-0000-5000-8000-000000000003",
        userId: "private-owner",
        status: "pending",
        createdAt: "2026-10-14T12:00:00.000Z",
      }],
      nextCursor: "opaque_cursor_123",
    });
  };
  const page = await loadVerifierDeliveryQueue(
    "http://127.0.0.1:5000",
    "verifier-token",
    "previous_cursor_123",
    new AbortController().signal,
    fakeFetch,
  );
  assert.match(requestUrl, /verifier\/deliveries\?/);
  assert.match(requestUrl, /limit=20/);
  assert.match(requestUrl, /cursor=previous_cursor_123/);
  assert.equal(page.items.length, 1);
  assert.equal("userId" in page.items[0], false);
  assert.equal(page.nextCursor, "opaque_cursor_123");
});

test("rejects malformed delivery and pagination responses", async () => {
  const invalidDelivery = async () => response({ id: "delivery", status: "invented", createdAt: "now" }, 201);
  await assert.rejects(
    createPilotDelivery("http://127.0.0.1:5000", "token", "delivery_operation_123", new AbortController().signal, invalidDelivery),
    (error) => error instanceof PilotApiError && error.status === 502,
  );
  const invalidQueue = async () => response({ items: [], nextCursor: 123 });
  await assert.rejects(
    loadVerifierDeliveryQueue("http://127.0.0.1:5000", "token", null, new AbortController().signal, invalidQueue),
    (error) => error instanceof PilotApiError && error.status === 502,
  );
});
test("loads only server-provided active delivery options", async () => {
  const fakeFetch = async () => response({
    mode: "detailed",
    enabled: true,
    reason: null,
    categories: [{ code: "paper" }],
    points: [{
      id: "00000000-0000-5000-8000-000000000010",
      code: "POINT-1",
      name: "Validated point",
      address: "Validated address",
      municipality: "Montería",
      timeZone: "America/Bogota",
      appointmentRequired: true,
      slots: [{
        id: "00000000-0000-5000-8000-000000000011",
        startsAt: "2099-01-01T14:00:00.000Z",
        endsAt: "2099-01-01T15:00:00.000Z",
        remainingCapacity: 2,
      }],
    }],
  });
  const options = await loadPilotDeliveryOptions("http://127.0.0.1:5000", "token", new AbortController().signal, fakeFetch);
  assert.equal(options.mode, "detailed");
  assert.equal(options.points[0].slots[0].remainingCapacity, 2);
});

test("creates a detailed request without owner, status, or points in the payload", async () => {
  let request;
  const pointId = "00000000-0000-5000-8000-000000000010";
  const slotId = "00000000-0000-5000-8000-000000000011";
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return response({
      id: "00000000-0000-5000-8000-000000000012",
      status: "pending",
      requestVersion: 2,
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
      deliveryPoint: { id: pointId, code: "POINT-1", name: "Validated point", address: "Validated address", municipality: "Montería" },
      slot: { id: slotId, startsAt: "2099-01-01T14:00:00.000Z", endsAt: "2099-01-01T15:00:00.000Z" },
      materials: [{ categoryCode: "paper", estimatedGrams: 2500 }],
      userId: "must-not-reach-ui",
    }, 201);
  };
  const result = await createDetailedPilotDelivery(
    "http://127.0.0.1:5000",
    "token",
    "delivery_detailed_123",
    { deliveryPointId: pointId, slotId, materials: [{ categoryCode: "paper", estimatedGrams: 2500 }] },
    new AbortController().signal,
    fakeFetch,
  );
  assert.equal(result.delivery.requestVersion, 2);
  assert.equal("userId" in result.delivery, false);
  assert.deepEqual(JSON.parse(request.options.body), {
    deliveryPointId: pointId,
    slotId,
    materials: [{ categoryCode: "paper", estimatedGrams: 2500 }],
  });
  assert.equal("points" in JSON.parse(request.options.body), false);
  assert.equal("status" in JSON.parse(request.options.body), false);
});

test("preserves structured API errors for safe retry decisions", async () => {
  const fakeFetch = async () => response({ error: "idempotency_key_reused" }, 409);
  await assert.rejects(
    createDetailedPilotDelivery(
      "http://127.0.0.1:5000",
      "token",
      "delivery_detailed_123",
      { deliveryPointId: "00000000-0000-5000-8000-000000000010", slotId: null, materials: [{ categoryCode: "paper", estimatedGrams: 1000 }] },
      new AbortController().signal,
      fakeFetch,
    ),
    (error) => error instanceof PilotApiError && error.status === 409 && error.code === "idempotency_key_reused",
  );
});

test("public centers come only from the authenticated server response", async () => {
  let authorization;
  const points = await loadPilotPublicPoints("http://127.0.0.1:5000", "session-token", new AbortController().signal, async (url, options) => {
    assert.match(String(url), /\/api\/pilot\/delivery-points$/);
    authorization = options.headers.Authorization;
    return response({ points: [{ id: "point-a", code: "center-a", name: "Verified center", address: "Verified address", municipality: "Montería", timeZone: "America/Bogota", appointmentRequired: true, slots: [], internalNote: "private" }] });
  });
  assert.equal(authorization, "Bearer session-token");
  assert.equal(points.length, 1);
  assert.equal("internalNote" in points[0], false);
  await assert.rejects(loadPilotPublicPoints("http://127.0.0.1:5000", "expired", new AbortController().signal, async () => response({ error: "authentication_required" }, 401)), error => error instanceof PilotApiError && error.status === 401);
  await assert.rejects(loadPilotPublicPoints("http://127.0.0.1:5000", "token", new AbortController().signal, async () => response({ points: [{ id: "bad", code: "bad", name: "Bad", address: "Bad", municipality: "Bad", timeZone: "America/Bogota", appointmentRequired: true, slots: [{ id: "slot", startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-01T01:00:00Z", remainingCapacity: 0 }] }] })), error => error instanceof PilotApiError && error.status === 502);
});

test("verifier client sends only the physical decision and handles disabled actions", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/verifier/capabilities")) return response({ receiptEnabled: false, decisionEnabled: false, pointsEnabled: false });
    if (String(url).endsWith("/events")) return response({ items: [{ fromStatus: "pending", toStatus: "received", reasonCode: null, createdAt: "2026-10-16T12:00:00.000Z" }] });
    return response({ error: "receipt_actions_disabled" }, 503);
  };
  const signal = new AbortController().signal;
  const capabilities = await loadVerifierCapabilities("http://127.0.0.1:5001", "session", signal, fakeFetch);
  assert.deepEqual(capabilities, { receiptEnabled: false, decisionEnabled: false, pointsEnabled: false });
  const events = await loadPilotDeliveryEvents("http://127.0.0.1:5001", "session", "delivery-id", signal, fakeFetch);
  assert.equal(events[0].toStatus, "received");
  await assert.rejects(receivePilotDelivery("http://127.0.0.1:5001", "session", "delivery-id", signal, fakeFetch), error => error instanceof PilotApiError && error.code === "receipt_actions_disabled");
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer session");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {});
  await assert.rejects(verifyPilotDelivery("http://127.0.0.1:5001", "session", "delivery-id", { decision: "rejected", reasonCode: "contaminated" }, signal, fakeFetch), error => error instanceof PilotApiError);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { decision: "rejected", reasonCode: "contaminated" });
});

test("progress client parses a strict educational report and rejects malformed data", async () => {
  const report = {
    ecoXp: 40, level: 2, levelTitle: "Brote", nextLevel: 3, nextLevelXp: 100, xpToNextLevel: 60,
    classificationCount: 4, distinctCategories: ["paper", "glass"], deliveryCount: 1, approvedDeliveryCount: 0,
    streakDays: 2,
    badges: [{ id: "first-scan", title: "Primer escaneo", description: "Clasificaste por primera vez", earned: true, earnedAt: "2026-10-10T00:00:00Z" }],
    missions: [{ id: "explorer", title: "Explorador", description: "Dos categorías", progress: 2, target: 2, completed: true, xpReward: 15 }],
    rules: ["Los escaneos no otorgan puntos"],
  };
  const fakeFetch = async () => response(report);
  const parsed = await loadPilotProgress("http://127.0.0.1:5001", "session", new AbortController().signal, fakeFetch);
  assert.equal(parsed.ecoXp, 40);
  assert.equal(parsed.levelTitle, "Brote");
  assert.deepEqual(parsed.distinctCategories, ["paper", "glass"]);
  assert.equal(parsed.badges[0].earned, true);
  assert.equal(parsed.missions[0].xpReward, 15);
  assert.deepEqual(parsed.rules, ["Los escaneos no otorgan puntos"]);
  await assert.rejects(
    loadPilotProgress("http://127.0.0.1:5001", "session", new AbortController().signal, async () => response({ ...report, ecoXp: "40" })),
    error => error instanceof PilotApiError && error.status === 502 && error.code === "invalid_eco_xp",
  );
});
