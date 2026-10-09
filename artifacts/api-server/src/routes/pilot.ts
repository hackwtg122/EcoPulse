import { randomUUID } from "node:crypto";
import { getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import { deliveries, pointMovements, redemptions, rewards, scans, users, verifications } from "@workspace/db/schema";
import { pointsForVerifiedGrams, validIdempotencyKey, validReceiptCode } from "../lib/pilotPolicy";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = new Set(["paper", "plastic", "glass", "metal", "organic", "other"]);
const mutationCounts = new Map<string, { count: number; resetAt: number }>();

// Keep the demo usable without infrastructure. Import the DB only after the
// mounted route has confirmed DATABASE_URL and Clerk configuration.
async function database() {
  const { db } = await import("@workspace/db");
  return db;
}

router.use(async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) return res.status(401).json({ error: "authentication_required" });
  try {
    const db = await database();
    await db.insert(users).values({ clerkUserId: userId }).onConflictDoNothing();
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.clerkUserId, userId));
    if (!user) return res.status(503).json({ error: "user_unavailable" });
    res.locals.userId = userId;
    res.locals.role = user.role;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const now = Date.now();
      const previous = mutationCounts.get(userId);
      const current = !previous || previous.resetAt <= now
        ? { count: 1, resetAt: now + 60_000 }
        : { count: previous.count + 1, resetAt: previous.resetAt };
      mutationCounts.set(userId, current);
      if (mutationCounts.size > 10_000) {
        for (const [id, entry] of mutationCounts) if (entry.resetAt <= now) mutationCounts.delete(id);
      }
      if (current.count > 20) return res.status(429).json({ error: "rate_limit_exceeded" });
    }
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/me", (req, res) => {
  res.json({ id: res.locals.userId, role: res.locals.role });
});

router.get("/balance", async (_req, res) => {
  const db = await database();
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${pointMovements.delta}), 0)::text` })
    .from(pointMovements).where(eq(pointMovements.userId, res.locals.userId));
  const balance = Number(row?.total ?? "0");
  if (!Number.isSafeInteger(balance)) return res.status(500).json({ error: "balance_out_of_range" });
  return res.json({ balance });
});

router.get("/scans", async (_req, res) => {
  const db = await database();
  const rows = await db.select().from(scans).where(eq(scans.userId, res.locals.userId))
    .orderBy(desc(scans.createdAt)).limit(50);
  res.json(rows);
});

router.post("/scans", async (req, res) => {
  const category = req.body?.category;
  if (typeof category !== "string" || !categories.has(category)) {
    return res.status(400).json({ error: "invalid_category" });
  }
  // Never accept claimed confidence, points, image, or location from a client.
  if (Object.keys(req.body).some((key) => key !== "category")) {
    return res.status(400).json({ error: "unexpected_fields" });
  }
  const db = await database();
  const [scan] = await db.insert(scans).values({ id: randomUUID(), userId: res.locals.userId, category, source: "manual" }).returning();
  return res.status(201).json(scan);
});

router.get("/deliveries", async (_req, res) => {
  const db = await database();
  const rows = await db.select().from(deliveries).where(eq(deliveries.userId, res.locals.userId))
    .orderBy(desc(deliveries.createdAt)).limit(50);
  res.json(rows);
});

router.post("/deliveries", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length) {
    return res.status(400).json({ error: "empty_object_required" });
  }
  const db = await database();
  const [delivery] = await db.insert(deliveries).values({ id: randomUUID(), userId: res.locals.userId }).returning();
  return res.status(201).json(delivery);
});

router.post("/deliveries/:id/verify", async (req, res) => {
  if (res.locals.role !== "verifier" && res.locals.role !== "admin") {
    return res.status(403).json({ error: "verifier_required" });
  }
  const id = req.params.id;
  const decision = req.body?.decision;
  const grams = req.body?.verifiedGrams;
  const receiptCode = req.body?.receiptCode;
  if (typeof id !== "string" || !uuidPattern.test(id) || (decision !== "approved" && decision !== "rejected")) {
    return res.status(400).json({ error: "invalid_verification" });
  }
  if (Object.keys(req.body).some((key) => key !== "decision" && key !== "verifiedGrams" && key !== "receiptCode")) {
    return res.status(400).json({ error: "unexpected_fields" });
  }
  if (decision === "approved" && (!Number.isSafeInteger(grams) || grams < 1 || grams > 100_000)) {
    return res.status(400).json({ error: "invalid_weight" });
  }
  if (decision === "rejected" && grams !== undefined) {
    return res.status(400).json({ error: "weight_not_allowed" });
  }
  if (decision === "approved" && !validReceiptCode(receiptCode)) {
    return res.status(400).json({ error: "receipt_required" });
  }
  if (decision === "rejected" && receiptCode !== undefined) {
    return res.status(400).json({ error: "receipt_not_allowed" });
  }
  const rate = Number(process.env.POINTS_PER_KG);
  if (decision === "approved" && (!Number.isSafeInteger(rate) || rate < 1 || rate > 1000)) {
    return res.status(503).json({ error: "points_policy_unconfigured" });
  }
  const db = await database();
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${deliveries.id} FROM ${deliveries} WHERE ${deliveries.id} = ${id} FOR UPDATE`);
    const [delivery] = await tx.select().from(deliveries).where(eq(deliveries.id, id));
    if (!delivery) return { status: 404, body: { error: "delivery_not_found" } };
    if (delivery.userId === res.locals.userId) return { status: 403, body: { error: "self_verification_forbidden" } };
    if (delivery.status !== "pending") return { status: 409, body: { error: "already_verified" } };
    const verificationId = randomUUID();
    const verifiedGrams = decision === "approved" ? grams as number : null;
    await tx.insert(verifications).values({ id: verificationId, deliveryId: id, verifierId: res.locals.userId, decision, verifiedGrams, receiptCode: decision === "approved" ? receiptCode : null });
    await tx.update(deliveries).set({ status: decision }).where(eq(deliveries.id, id));
    const points = decision === "approved" ? pointsForVerifiedGrams(verifiedGrams!, rate) : 0;
    if (points > 0) {
      await tx.insert(pointMovements).values({ id: randomUUID(), userId: delivery.userId, delta: points, kind: "delivery", sourceId: verificationId });
    }
    return { status: 200, body: { deliveryId: id, decision, verifiedGrams, points } };
  });
  return res.status(outcome.status).json(outcome.body);
});

router.get("/rewards", async (_req, res) => {
  const db = await database();
  const rows = await db.select().from(rewards).where(eq(rewards.active, true)).limit(50);
  res.json(rows);
});

router.get("/redemptions", async (_req, res) => {
  const db = await database();
  const rows = await db.select().from(redemptions).where(eq(redemptions.userId, res.locals.userId))
    .orderBy(desc(redemptions.createdAt)).limit(50);
  res.json(rows);
});

router.post("/redemptions", async (req, res) => {
  const rewardId = req.body?.rewardId;
  const key = req.header("Idempotency-Key");
  if (typeof rewardId !== "string" || !uuidPattern.test(rewardId) || !validIdempotencyKey(key)) {
    return res.status(400).json({ error: "invalid_redemption" });
  }
  if (Object.keys(req.body).some((field) => field !== "rewardId")) {
    return res.status(400).json({ error: "unexpected_fields" });
  }
  const userId: string = res.locals.userId;
  const db = await database();
  const outcome = await db.transaction(async (tx) => {
    // Serialize debits for this user, including concurrent requests with different keys.
    await tx.execute(sql`SELECT ${users.clerkUserId} FROM ${users} WHERE ${users.clerkUserId} = ${userId} FOR UPDATE`);
    const [prior] = await tx.select().from(redemptions)
      .where(and(eq(redemptions.userId, userId), eq(redemptions.idempotencyKey, key)));
    if (prior) {
      return prior.rewardId === rewardId
        ? { status: 200, body: prior }
        : { status: 409, body: { error: "idempotency_key_reused" } };
    }
    await tx.execute(sql`SELECT ${rewards.id} FROM ${rewards} WHERE ${rewards.id} = ${rewardId} FOR UPDATE`);
    const [reward] = await tx.select().from(rewards).where(eq(rewards.id, rewardId));
    if (!reward || !reward.active) return { status: 404, body: { error: "reward_unavailable" } };
    const [row] = await tx.select({ total: sql<string>`coalesce(sum(${pointMovements.delta}), 0)::text` })
      .from(pointMovements).where(eq(pointMovements.userId, userId));
    const balance = Number(row?.total ?? "0");
    if (!Number.isSafeInteger(balance)) return { status: 500, body: { error: "balance_out_of_range" } };
    if (balance < reward.cost) return { status: 409, body: { error: "insufficient_points" } };
    const [redemption] = await tx.insert(redemptions).values({
      id: randomUUID(), userId, rewardId, cost: reward.cost, idempotencyKey: key,
    }).returning();
    await tx.insert(pointMovements).values({
      id: randomUUID(), userId, delta: -reward.cost, kind: "redemption", sourceId: redemption.id,
    });
    return { status: 201, body: redemption };
  });
  return res.status(outcome.status).json(outcome.body);
});

const pilotErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (typeof error === "object" && error && "code" in error && error.code === "23505") {
    return res.status(409).json({ error: "duplicate_operation" });
  }
  logger.error({ error, path: req.path }, "Pilot API request failed");
  return res.status(500).json({ error: "pilot_api_error" });
};
router.use(pilotErrorHandler);

export default router;
