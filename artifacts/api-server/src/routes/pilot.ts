import { getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import { pointMovements, scans, users, deliveries, deliveryPoints } from "@workspace/db/schema";
import { canAccessVerifierQueue, encodeDeliveryCursor, hasOnlyFields, parseDeliveryCursor, parseDeliveryPageLimit, scanIdForIdempotency, uuidPattern, validIdempotencyKey, validReceiptCode, validRejectionReason, validScanCategory, parsePointsPolicy, verificationActionsEnabled } from "../lib/pilotPolicy";
import { createDetailedDelivery, createLegacyDelivery, DeliveryRequestError, deliveryDetailsEnabled, hasDeliveryDetailsSchema, listUserDeliveries, listVerifierDeliveries, loadDeliveryOptions, parseDetailedDeliveryInput } from "../lib/deliveryDetails";
import { DeliveryLifecycleError, receivePhysicalDelivery, verifyPhysicalDelivery } from "../lib/deliveryLifecycle";
import { canManageCatalog, CatalogError, createDraftPoint, createDraftSlot, deactivateCatalogRecord, hasCatalogValidationSchema, listCatalog, parseDraftPoint, parseDraftSlot, parsePointEdit, parseSlotEdit, parseValidationReference, updateActiveSlotCapacity, updateDraftPoint, updateDraftSlot, validateCatalogPoint, validateCatalogSlot } from "../lib/deliveryCatalog";
import { RewardError, createRewardDraft, editRewardDraft, fulfillRedemption, hasRewardFulfillmentSchema, listReservedRedemptions, parseRewardDraft, redeemReward, redemptionActionsEnabled } from "../lib/rewardService";
import { AiClassificationError, parseAiSuggestion, sanitizePng } from "../lib/aiClassification";
import { AiGuideError, askGuideWithProvider, parseGuideRequest } from "../lib/aiGuide";
import { AiProviderError, ProviderConfig, VERIFIED_FREE_OPEN_MODELS, classifyImageWithVision } from "../lib/aiProvider";
import { QuotaConfig, QuotaStoreError, reserveQuota, finishQuotaAttempt } from "../lib/aiQuota";
import { computeProgress } from "../lib/progressService";
import { listEvaluationTestPoints } from "../lib/evaluationPoints";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const mutationCounts = new Map<string, { count: number; resetAt: number }>();
const officialAiBase = !process.env.AI_BASE_URL || process.env.AI_BASE_URL.replace(/\/$/, "") === "https://openrouter.ai/api/v1";

const quotaCfg: QuotaConfig = {
  store: (process.env.AI_QUOTA_STORE === "memory" ? "memory" : "file"),
  filePath: process.env.AI_QUOTA_FILE_PATH || "./storage/ai_quota.json",
  dailyGlobalFreeReq: Number(process.env.AI_DAILY_GLOBAL_FREE_REQ) || 50,
  dailyPerUserFreeReq: Number(process.env.AI_DAILY_PER_USER_FREE_REQ) || 8,
  minutePerUserEcoScan: Number(process.env.AI_MINUTE_PER_USER_FREE_REQ) || 2,
  minutePerUserEcoGuide: Number(process.env.AI_GUIDE_MINUTE_PER_USER_FREE_REQ) || 4,
};

function reserveAiAttempt(userId: string, kind: "ecoscan" | "ecoguide") {
  return (model: string, attempt: number) => {
    try {
      const result = reserveQuota(quotaCfg, userId, kind, Date.now(), { model, number: attempt });
      if (!result.ok) throw new AiProviderError(429, "ai_rate_limited");
      if (!result.attemptId) throw new AiProviderError(503, "ai_quota_store_unavailable");
      return result.attemptId;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof QuotaStoreError) throw new AiProviderError(503, "ai_quota_store_unavailable");
      throw error;
    }
  };
}

function buildProviderConfig(): ProviderConfig {
  const provider = (process.env.AI_PROVIDER === "groq" || process.env.AI_PROVIDER === "custom") ? (process.env.AI_PROVIDER as any) : "openrouter";
  return {
    provider,
    apiKey: process.env.AI_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || undefined,
    visionModel: process.env.AI_VISION_MODEL || "openrouter/free",
    chatModel: process.env.AI_CHAT_MODEL || "openrouter/free",
    visionAllowlist: (process.env.AI_VISION_MODEL_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean),
    chatAllowlist: (process.env.AI_CHAT_MODEL_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean),
    requireOpenLicense: true,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 15000,
    maxRetries: Number(process.env.AI_MAX_RETRIES) || 2,
    retryBackoffMs: Number(process.env.AI_RETRY_BACKOFF_MS) || 500,
    visionMaxTokens: Number(process.env.AI_MAX_TOKENS_VISION) || 1000,
    chatMaxTokens: Number(process.env.AI_MAX_TOKENS_CHAT) || 2000,
  };
}

router.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

// Keep the demo usable without infrastructure. Import the DB only after the
// mounted route has confirmed DATABASE_URL and Clerk configuration.
async function database() {
  const { db } = await import("@workspace/db");
  return db;
}

async function databasePool() {
  const { pool } = await import("@workspace/db");
  return pool;
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
    return next();
  } catch (error) {
    return next(error);
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

router.get("/point-movements", async (_req, res) => {
  const db = await database();
  const history = await db.select({
    id: pointMovements.id, delta: pointMovements.delta,
    kind: pointMovements.kind, createdAt: pointMovements.createdAt,
  }).from(pointMovements).where(eq(pointMovements.userId, res.locals.userId))
    .orderBy(desc(pointMovements.createdAt)).limit(50);
  return res.json(history);
});

router.get("/favorites", async (_req, res) => {
  if (process.env.EVALUATION_MODE_ENABLED !== "true") return res.json({ enabled: false, ids: [] });
  const pool = await databasePool();
  const schema = await pool.query<{ ready: boolean }>("SELECT to_regclass('public.favorite_centers') IS NOT NULL AS ready");
  if (!schema.rows[0]?.ready) return res.json({ enabled: false, ids: [] });
  const favorites = await pool.query<{ delivery_point_id: string }>(
    "SELECT delivery_point_id FROM favorite_centers WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [res.locals.userId]);
  return res.json({ enabled: true, ids: favorites.rows.map(row => row.delivery_point_id) });
});

router.post("/favorites/:id", async (req, res) => {
  if (process.env.EVALUATION_MODE_ENABLED !== "true") return res.status(503).json({ error: "favorites_unavailable" });
  const id = String(req.params.id);
  if (!uuidPattern.test(id) || !hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "invalid_favorite" });
  const pool = await databasePool();
  const result = await pool.query(`INSERT INTO favorite_centers (user_id, delivery_point_id)
    SELECT $1, id FROM delivery_points WHERE id=$2 AND active=true
    ON CONFLICT (user_id, delivery_point_id) DO NOTHING RETURNING delivery_point_id`, [res.locals.userId, id]);
  if (!result.rowCount) {
    const exists = await pool.query("SELECT 1 FROM favorite_centers WHERE user_id=$1 AND delivery_point_id=$2", [res.locals.userId, id]);
    if (!exists.rowCount) return res.status(404).json({ error: "center_unavailable" });
  }
  return res.status(result.rowCount ? 201 : 200).json({ id });
});

router.delete("/favorites/:id", async (req, res) => {
  if (process.env.EVALUATION_MODE_ENABLED !== "true") return res.status(503).json({ error: "favorites_unavailable" });
  const id = String(req.params.id);
  if (!uuidPattern.test(id)) return res.status(400).json({ error: "invalid_favorite" });
  const pool = await databasePool();
  await pool.query("DELETE FROM favorite_centers WHERE user_id=$1 AND delivery_point_id=$2", [res.locals.userId, id]);
  return res.sendStatus(204);
});

// Progreso educativo (EcoXP). Es una métrica de aprendizaje derivada en el servidor
// desde clasificaciones y entregas reales; no es un libro contable ni otorga EcoPuntos.
router.get("/progress", async (_req, res) => {
  const db = await database();
  const scanRows = await db.select({ category: scans.category, createdAt: scans.createdAt })
    .from(scans).where(eq(scans.userId, res.locals.userId));
  const deliveryRows = await db.select({ status: deliveries.status, createdAt: deliveries.createdAt })
    .from(deliveries).where(eq(deliveries.userId, res.locals.userId));
  return res.json(computeProgress(scanRows, deliveryRows));
});

router.get("/scans/ai-capabilities", (_req, res) => {
  const missing: string[] = [];
  if (process.env.PILOT_AI_ENABLED !== "true") missing.push("PILOT_AI_ENABLED");
  if (!process.env.AI_API_KEY && !process.env.OPENAI_API_KEY) missing.push("AI_API_KEY");
  if ((process.env.AI_PROVIDER || "openrouter") !== "openrouter") missing.push("AI_PROVIDER");
  if (!officialAiBase) missing.push("AI_BASE_URL");
  const vision = process.env.AI_VISION_MODEL || "openrouter/free";
  if (!(VERIFIED_FREE_OPEN_MODELS as readonly string[]).includes(vision)) missing.push("AI_VISION_MODEL");
  const providerReady = missing.length === 0;
  return res.json({ enabled: providerReady, provider: providerReady ? (process.env.AI_PROVIDER || "openrouter") : null, missing });
});
router.post("/scans/classify", async (req, res) => {
  if (req.get("X-AI-Consent") !== "true") return res.status(403).json({ error: "ai_consent_required" });
  const aiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const vision = process.env.AI_VISION_MODEL || "openrouter/free";
  if (process.env.PILOT_AI_ENABLED !== "true" || !aiKey || !officialAiBase || (process.env.AI_PROVIDER || "openrouter") !== "openrouter" ||
      !(VERIFIED_FREE_OPEN_MODELS as readonly string[]).includes(vision)) {
    return res.status(503).json({ error: "ai_provider_unconfigured" });
  }
  if (!req.is("image/png") || !Buffer.isBuffer(req.body)) return res.status(415).json({ error: "png_required" });
  let sanitized: Buffer;
  try { sanitized = sanitizePng(req.body); }
  catch (error) { return res.status(error instanceof AiClassificationError ? error.status : 400).json({ error: error instanceof AiClassificationError ? error.code : "invalid_image" }); }
  const uid = res.locals.userId;
  const cfg = buildProviderConfig();
  cfg.apiKey = aiKey;
  cfg.visionModel = vision;
  cfg.beforeAttempt = reserveAiAttempt(uid, "ecoscan");
  cfg.afterAttempt = (id, status, durationMs, errorCode) => finishQuotaAttempt(quotaCfg, id, status, durationMs, errorCode);
  try {
    const resProv = await classifyImageWithVision(cfg, sanitized.toString("base64"));
    return res.json(resProv);
  } catch (e) {
    return res.status(e instanceof AiProviderError ? e.status : 502).json({ error: e instanceof AiProviderError ? e.code : "ai_provider_unavailable" });
  }
});

const guideModel = process.env.AI_CHAT_MODEL || process.env.OPENAI_GUIDE_MODEL || process.env.OPENAI_VISION_MODEL || "openrouter/free";
router.get("/guide/capabilities", (_req, res) => {
  const missing: string[] = [];
  if (process.env.PILOT_AI_ENABLED !== "true") missing.push("PILOT_AI_ENABLED");
  if ((process.env.AI_PROVIDER || "openrouter") !== "openrouter") missing.push("AI_PROVIDER");
  if (!officialAiBase) missing.push("AI_BASE_URL");
  const aiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!aiKey) missing.push("AI_API_KEY");
  if (!(VERIFIED_FREE_OPEN_MODELS as readonly string[]).includes(guideModel)) missing.push("AI_CHAT_MODEL");
  const providerReady = missing.length === 0;
  return res.json({ enabled: providerReady, provider: providerReady ? (process.env.AI_PROVIDER || "openrouter") : null, missing });
});
router.post("/guide/ask", async (req, res) => {
  if (req.get("X-AI-Consent") !== "true") return res.status(403).json({ error: "ai_consent_required" });
  const aiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (process.env.PILOT_AI_ENABLED !== "true" || !aiKey || !officialAiBase || (process.env.AI_PROVIDER || "openrouter") !== "openrouter" ||
      !(VERIFIED_FREE_OPEN_MODELS as readonly string[]).includes(guideModel)) {
    return res.status(503).json({ error: "ai_provider_unconfigured" });
  }
  if (!hasOnlyFields(req.body, ["question", "history", "materialContext"])) return res.status(400).json({ error: "unexpected_fields" });
  const request = parseGuideRequest(req.body);
  const uid = res.locals.userId;
  const cfg = buildProviderConfig();
  cfg.apiKey = aiKey;
  cfg.chatModel = guideModel;
  cfg.beforeAttempt = reserveAiAttempt(uid, "ecoguide");
  cfg.afterAttempt = (id, status, durationMs, errorCode) => finishQuotaAttempt(quotaCfg, id, status, durationMs, errorCode);
  const db = await database();
  const [balanceRow] = await db.select({ total: sql<string>`coalesce(sum(${pointMovements.delta}), 0)::text` }).from(pointMovements).where(eq(pointMovements.userId, uid));
  const scanCount = await db.select({ c: sql<number>`count(*)::int` }).from(scans).where(eq(scans.userId, uid));
  const deliveryCount = await db.select({ c: sql<number>`count(*)::int` }).from(deliveries).where(eq(deliveries.userId, uid));
  const centers = await db.select({ c: sql<number>`count(*)::int` }).from(deliveryPoints).where(eq(deliveryPoints.active, true));
  const userContext = {
    balance: Math.trunc(Number(balanceRow?.total ?? "0")),
    scanCount: Math.trunc(Number(scanCount[0]?.c ?? 0)),
    deliveryCount: Math.trunc(Number(deliveryCount[0]?.c ?? 0)),
    activeCenters: Math.trunc(Number(centers[0]?.c ?? 0)),
    pointsPolicyEnabled: verificationActionsEnabled(process.env.PILOT_POINTS_ENABLED),
    academic: process.env.EVALUATION_MODE_ENABLED === "true",
  };
  try {
    const result = await askGuideWithProvider(request, userContext, cfg);
    return res.json(result);
  } catch (e) {
    return res.status(e instanceof AiProviderError ? e.status : 502).json({ error: e instanceof AiProviderError ? e.code : "ai_provider_unavailable" });
  }
});
router.get("/scans", async (_req, res) => {
  const db = await database();
  const rows = await db.select().from(scans).where(eq(scans.userId, res.locals.userId))
    .orderBy(desc(scans.createdAt)).limit(50);
  res.json(rows);
});

router.post("/scans", async (req, res) => {
  if (!hasOnlyFields(req.body, ["category"])) {
    return res.status(400).json({ error: "unexpected_fields" });
  }
  const category = req.body?.category;
  if (!validScanCategory(category)) {
    return res.status(400).json({ error: "invalid_category" });
  }
  const idempotencyKey = req.get("Idempotency-Key");
  if (!validIdempotencyKey(idempotencyKey)) {
    return res.status(400).json({ error: "invalid_idempotency_key" });
  }
  // Never accept claimed confidence, points, image, or location from a client.
  const db = await database();
  const scanId = scanIdForIdempotency(res.locals.userId, idempotencyKey);
  const [created] = await db.insert(scans)
    .values({ id: scanId, userId: res.locals.userId, category, source: "manual" })
    .onConflictDoNothing({ target: scans.id })
    .returning();
  if (created) return res.status(201).json(created);

  const [existing] = await db.select().from(scans)
    .where(and(eq(scans.id, scanId), eq(scans.userId, res.locals.userId)));
  if (!existing) return res.status(409).json({ error: "idempotency_conflict" });
  if (existing.category !== category || existing.source !== "manual") {
    return res.status(409).json({ error: "idempotency_key_reused" });
  }
  res.set("Idempotency-Replayed", "true");
  return res.status(200).json(existing);
});

router.get("/admin/catalog", async (_req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  const validationReady = await hasCatalogValidationSchema(pool);
  return res.json({ ...await listCatalog(pool, validationReady), editingEnabled: process.env.PILOT_CATALOG_ADMIN_ENABLED === "true", validationReady, publishingEnabled: validationReady && process.env.PILOT_CATALOG_PUBLICATION_ENABLED === "true" });
});

// Aggregated operational counts for administrators. Read-only: no personal
// identifiers, no exports, and no writes. Points/redemption totals reflect
// only confirmed server movements.
router.get("/admin/stats", async (_req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  const [usersRow, scansRow, deliveriesRow, redemptionsRow] = await Promise.all([
    pool.query<{ total: number }>("SELECT count(*)::integer AS total FROM users"),
    pool.query<{ total: number }>("SELECT count(*)::integer AS total FROM scans"),
    pool.query<{ status: string; total: number }>("SELECT status, count(*)::integer AS total FROM deliveries GROUP BY status ORDER BY status"),
    pool.query<{ fulfillment_status: string | null; total: number }>(
      "SELECT fulfillment_status, count(*)::integer AS total FROM redemptions GROUP BY fulfillment_status ORDER BY fulfillment_status",
    ),
  ]);
  const balanceRow = await pool.query<{ total: number }>("SELECT coalesce(sum(delta), 0)::integer AS total FROM point_movements");
  return res.json({
    users: usersRow.rows[0]?.total ?? 0,
    scans: scansRow.rows[0]?.total ?? 0,
    deliveriesByStatus: deliveriesRow.rows.map((row) => ({ status: row.status, total: row.total })),
    redemptionsByFulfillment: redemptionsRow.rows.map((row) => ({ fulfillmentStatus: row.fulfillment_status, total: row.total })),
    pointsBalance: balanceRow.rows[0]?.total ?? 0,
  });
});

router.post("/admin/catalog/points", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  const input = parseDraftPoint(req.body);
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  return res.status(201).json(await createDraftPoint(pool, input));
});

router.post("/admin/catalog/slots", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  const input = parseDraftSlot(req.body);
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  return res.status(201).json(await createDraftSlot(pool, input));
});
router.patch("/admin/catalog/points/:id", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_point_id" });
  const input = parsePointEdit(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await updateDraftPoint(pool, String(req.params.id), input));
});
router.patch("/admin/catalog/slots/:id", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_slot_id" });
  const input = parseSlotEdit(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await updateDraftSlot(pool, String(req.params.id), input));
});
router.post("/admin/catalog/points/:id/validate", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_point_id" });
  const reference = parseValidationReference(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  const result = await validateCatalogPoint(pool, String(req.params.id), res.locals.userId, reference);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result.point);
});
router.post("/admin/catalog/slots/:id/validate", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_slot_id" });
  const reference = parseValidationReference(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  const result = await validateCatalogSlot(pool, String(req.params.id), res.locals.userId, reference);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result.slot);
});
router.patch("/admin/catalog/slots/:id/capacity", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if (!uuidPattern.test(String(req.params.id)) || !hasOnlyFields(req.body, ["capacity", "validationReference"])) return res.status(400).json({ error: "invalid_capacity_change" });
  const reference = parseValidationReference({ validationReference: req.body.validationReference });
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await updateActiveSlotCapacity(pool, String(req.params.id), res.locals.userId, req.body.capacity, reference));
});
router.post("/admin/catalog/:kind/:id/deactivate", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if ((req.params.kind !== "points" && req.params.kind !== "slots") || !uuidPattern.test(String(req.params.id)) || !hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "invalid_catalog_record" });
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await deactivateCatalogRecord(pool, req.params.kind, String(req.params.id)));
});
router.get("/delivery-points", async (_req, res) => {
  const pool = await databasePool();
  const options = await loadDeliveryOptions(pool, true);
  return res.json({ points: options.points });
});

// Evaluation-only test points. Served statically by this API (no database,
// no persistence, never mixed with published centers). They are clearly
// labelled as test data and never accept public physical deliveries.
router.get("/evaluation-points", async (_req, res) => {
  return res.json({ points: listEvaluationTestPoints(), evaluation: true });
});
router.get("/delivery-options", async (_req, res) => {
  const pool = await databasePool();
  const options = await loadDeliveryOptions(pool, deliveryDetailsEnabled(process.env.PILOT_DELIVERY_DETAILS_ENABLED));
  return res.json(options);
});

router.get("/deliveries", async (_req, res) => {
  const pool = await databasePool();
  const rows = await listUserDeliveries(pool, res.locals.userId);
  return res.json(rows);
});

router.post("/deliveries", async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key");
  if (!validIdempotencyKey(idempotencyKey)) {
    return res.status(400).json({ error: "invalid_idempotency_key" });
  }
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
    return res.status(400).json({ error: "invalid_delivery_request" });
  }

  const userId: string = res.locals.userId;
  const pool = await databasePool();
  const featureRequested = deliveryDetailsEnabled(process.env.PILOT_DELIVERY_DETAILS_ENABLED);
  const schemaReady = await hasDeliveryDetailsSchema(pool);
  const detailedPayload = Object.keys(req.body).length > 0;

  if (!detailedPayload) {
    if (featureRequested && schemaReady) {
      const options = await loadDeliveryOptions(pool, true);
      if (!options.enabled) return res.status(503).json({ error: "delivery_details_configuration_unavailable" });
      return res.status(400).json({ error: "detailed_delivery_required" });
    }
    const result = await createLegacyDelivery(pool, userId, idempotencyKey);
    if (result.replayed) res.set("Idempotency-Replayed", "true");
    return res.status(result.replayed ? 200 : 201).json(result.delivery);
  }

  if (!featureRequested) {
    return res.status(503).json({ error: "delivery_details_disabled" });
  }
  if (!schemaReady) {
    return res.status(503).json({ error: "delivery_details_migration_required" });
  }
  const options = await loadDeliveryOptions(pool, true);
  if (!options.enabled) {
    return res.status(503).json({ error: "delivery_details_configuration_unavailable" });
  }

  const input = parseDetailedDeliveryInput(req.body);
  const result = await createDetailedDelivery(pool, userId, idempotencyKey, input);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.delivery);
});
router.get("/verifier/capabilities", async (_req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) return res.status(403).json({ error: "verifier_required" });
  const pool = await databasePool();
  const schemaReady = await hasDeliveryDetailsSchema(pool);
  const policyReady = parsePointsPolicy(process.env.POINTS_PER_KG, process.env.POINTS_MAX_PER_DELIVERY) !== null;
  return res.json({
    receiptEnabled: schemaReady && verificationActionsEnabled(process.env.PILOT_RECEIPT_ENABLED),
    decisionEnabled: schemaReady && verificationActionsEnabled(process.env.PILOT_VERIFICATION_ENABLED),
    pointsEnabled: schemaReady && verificationActionsEnabled(process.env.PILOT_VERIFICATION_ENABLED)
      && verificationActionsEnabled(process.env.PILOT_POINTS_ENABLED) && policyReady,
  });
});
router.get("/deliveries/:id/events", async (req, res) => {
  const id = String(req.params.id);
  if (!uuidPattern.test(id)) return res.status(400).json({ error: "invalid_delivery" });
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  const delivery = await pool.query<{ user_id: string }>("SELECT user_id FROM deliveries WHERE id = $1", [id]);
  if (!delivery.rows[0] || (delivery.rows[0].user_id !== res.locals.userId && !canAccessVerifierQueue(res.locals.role))) {
    return res.status(404).json({ error: "delivery_not_found" });
  }
  const events = await pool.query(`SELECT from_status AS "fromStatus", to_status AS "toStatus",
    reason_code AS "reasonCode", created_at AS "createdAt"
    FROM delivery_status_events WHERE delivery_id = $1 ORDER BY created_at, id LIMIT 100`, [id]);
  return res.json({ items: events.rows });
});
router.get("/verifier/deliveries", async (req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) {
    return res.status(403).json({ error: "verifier_required" });
  }
  const limit = parseDeliveryPageLimit(req.query.limit);
  const cursor = parseDeliveryCursor(req.query.cursor);
  if (limit === null || !cursor.ok) {
    return res.status(400).json({ error: "invalid_pagination" });
  }
  const pool = await databasePool();
  const rows = await listVerifierDeliveries(pool, res.locals.userId, limit + 1, cursor.value);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last
    ? encodeDeliveryCursor(last.createdAt, last.id)
    : null;
  return res.json({ items, nextCursor });
});
router.post("/deliveries/:id/receive", async (req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) return res.status(403).json({ error: "verifier_required" });
  if (!verificationActionsEnabled(process.env.PILOT_RECEIPT_ENABLED)) {
    return res.status(503).json({ error: "receipt_actions_disabled" });
  }
  if (!hasOnlyFields(req.body ?? {}, []) || typeof req.params.id !== "string" || !uuidPattern.test(req.params.id)) {
    return res.status(400).json({ error: "invalid_delivery" });
  }
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) {
    return res.status(503).json({ error: "delivery_details_migration_required" });
  }
  const result = await receivePhysicalDelivery(pool, res.locals.userId, res.locals.role, req.params.id);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});

router.post("/deliveries/:id/verify", async (req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) {
    return res.status(403).json({ error: "verifier_required" });
  }
  if (!verificationActionsEnabled(process.env.PILOT_VERIFICATION_ENABLED)) {
    return res.status(503).json({ error: "verification_actions_disabled" });
  }
  if (!hasOnlyFields(req.body, ["decision", "verifiedGrams", "receiptCode", "reasonCode"])) {
    return res.status(400).json({ error: "unexpected_fields" });
  }
  const id = req.params.id;
  const decision = req.body?.decision;
  const grams = req.body?.verifiedGrams;
  const receiptCode = req.body?.receiptCode;
  const reasonCode = req.body?.reasonCode;
  if (typeof id !== "string" || !uuidPattern.test(id) || (decision !== "approved" && decision !== "rejected")) {
    return res.status(400).json({ error: "invalid_verification" });
  }
  if (decision === "approved" && (typeof grams !== "number" || !Number.isSafeInteger(grams) || grams < 1 || grams > 100_000)) {
    return res.status(400).json({ error: "invalid_weight" });
  }
  if (decision === "rejected" && grams !== undefined) {
    return res.status(400).json({ error: "weight_not_allowed" });
  }
  if (decision === "approved" && !validReceiptCode(receiptCode)) {
    return res.status(400).json({ error: "receipt_required" });
  }
  if (decision === "rejected" && (receiptCode !== undefined || !validRejectionReason(reasonCode))) {
    return res.status(400).json({ error: "rejection_reason_required" });
  }
  if (decision === "approved" && reasonCode !== undefined) return res.status(400).json({ error: "rejection_reason_not_allowed" });
  if (decision === "approved" && !verificationActionsEnabled(process.env.PILOT_POINTS_ENABLED)) {
    return res.status(503).json({ error: "points_disabled" });
  }
  const policy = parsePointsPolicy(process.env.POINTS_PER_KG, process.env.POINTS_MAX_PER_DELIVERY);
  if (decision === "approved" && !policy) return res.status(503).json({ error: "points_policy_unconfigured" });
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) {
    return res.status(503).json({ error: "delivery_details_migration_required" });
  }
  const result = await verifyPhysicalDelivery(
    pool, res.locals.userId, res.locals.role, id, decision,
    decision === "approved" ? grams as number : null,
    decision === "approved" ? receiptCode as string : null,
    decision === "approved" ? policy!.pointsPerKg : null,
    decision === "rejected" && validRejectionReason(reasonCode) ? reasonCode : null,
    decision === "approved" ? policy!.maxPointsPerDelivery : null,
  );
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});
router.get("/rewards/capabilities", async (_req, res) => {
  const pool = await databasePool();
  const schemaReady = await hasRewardFulfillmentSchema(pool);
  const privileges = await pool.query<{ draft_insert: boolean }>("SELECT has_column_privilege(current_user,'public.rewards','title','INSERT') AS draft_insert");
  return res.json({
    canRedeem: redemptionActionsEnabled({ rewards: process.env.PILOT_REWARDS_ENABLED, points: process.env.PILOT_POINTS_ENABLED,
      fulfillment: process.env.PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, schemaReady),
    canManageDrafts: res.locals.role === "admin" && process.env.PILOT_REWARD_ADMIN_ENABLED === "true" && privileges.rows[0]?.draft_insert === true,
    canFulfill: res.locals.role === "admin" && process.env.PILOT_REWARD_FULFILLMENT_ENABLED === "true" && process.env.PILOT_REWARDS_ENABLED === "true",
    schemaReady,
  });
});
router.get("/rewards", async (_req, res) => {
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.json([]);
  const rows = await pool.query(`SELECT id,title,description,cost,active,inventory_remaining AS "inventoryRemaining" FROM rewards
    WHERE active=true AND inventory_remaining>0 AND fulfillment_reference IS NOT NULL
    ORDER BY created_at DESC,id DESC LIMIT 50`);
  return res.json(rows.rows);
});
router.get("/admin/rewards", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  const rows = await pool.query("SELECT id,title,description,cost,active,inventory_remaining AS \"inventoryRemaining\",fulfillment_reference IS NOT NULL AS \"fulfillmentDocumented\",validated_at IS NOT NULL AS \"validationRecorded\",created_at AS \"createdAt\" FROM rewards ORDER BY created_at DESC,id DESC LIMIT 100");
  return res.json(rows.rows);
});
router.post("/admin/rewards", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_REWARD_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "reward_drafts_disabled" });
  const input = parseRewardDraft(req.body);
  const pool = await databasePool();
  const result = await createRewardDraft(pool, res.locals.userId, req.header("Idempotency-Key"), input);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.reward);
});
router.patch("/admin/rewards/:id", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_REWARD_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "reward_drafts_disabled" });
  if (!hasOnlyFields(req.body, ["expected", "next"]) || !req.body.expected || !req.body.next) return res.status(400).json({ error: "invalid_reward_edit" });
  const pool = await databasePool();
  const result = await editRewardDraft(pool, String(req.params.id), parseRewardDraft(req.body.expected), parseRewardDraft(req.body.next));
  return res.json(result);
});
router.get("/redemptions", async (_req, res) => {
  const pool = await databasePool();
  const schemaReady = await hasRewardFulfillmentSchema(pool);
  const rows = await pool.query(`SELECT r.id,r.reward_id AS "rewardId",w.title AS "rewardTitle",r.cost,r.created_at AS "createdAt",
    ${schemaReady ? "r.fulfillment_status" : "'reserved'::text"} AS "fulfillmentStatus"
    FROM redemptions r JOIN rewards w ON w.id=r.reward_id WHERE r.user_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 50`, [res.locals.userId]);
  return res.json(rows.rows);
});
router.post("/redemptions", async (req, res) => {
  const pool = await databasePool();
  const schemaReady = await hasRewardFulfillmentSchema(pool);
  if (!redemptionActionsEnabled({ rewards: process.env.PILOT_REWARDS_ENABLED, points: process.env.PILOT_POINTS_ENABLED,
    fulfillment: process.env.PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, schemaReady)) {
    return res.status(503).json({ error: "redemptions_disabled" });
  }
  if (!hasOnlyFields(req.body, ["rewardId"]) || typeof req.body.rewardId !== "string") return res.status(400).json({ error: "invalid_redemption" });
  const result = await redeemReward(pool, res.locals.userId, req.body.rewardId, req.header("Idempotency-Key"));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.redemption);
});
router.get("/admin/redemptions", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.json([]);
  return res.json(await listReservedRedemptions(pool));
});
router.post("/admin/redemptions/:id/fulfill", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (process.env.PILOT_REWARD_FULFILLMENT_ENABLED !== "true" || process.env.PILOT_REWARDS_ENABLED !== "true") {
    return res.status(503).json({ error: "fulfillment_disabled" });
  }
  if (!hasOnlyFields(req.body, ["reference"]) || typeof req.body.reference !== "string") return res.status(400).json({ error: "invalid_fulfillment_reference" });
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.status(503).json({ error: "reward_migration_required" });
  return res.json(await fulfillRedemption(pool, res.locals.userId, String(req.params.id), req.body.reference));
});

const pilotErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof DeliveryRequestError || error instanceof DeliveryLifecycleError || error instanceof CatalogError || error instanceof RewardError || error instanceof AiClassificationError || error instanceof AiGuideError) {
    return res.status(error.status).json({ error: error.code });
  }
  if (typeof error === "object" && error && "code" in error && error.code === "42501") {
    return res.status(503).json({ error: "permissions_unavailable" });
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23505") {
    return res.status(409).json({ error: "duplicate_operation" });
  }
  logger.error({ error, path: req.path }, "Pilot API request failed");
  return res.status(500).json({ error: "pilot_api_error" });
};
router.use(pilotErrorHandler);

router.patch("/admin/users/:clerkUserId/role", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "forbidden" });
  const target = String(req.params.clerkUserId || "").trim();
  const requestedRole = String(req.body?.role || "").trim();
  if (!target || !/^user_[A-Za-z0-9]+$/.test(target)) return res.status(400).json({ error: "invalid_target" });
  if (!["participant", "verifier", "admin"].includes(requestedRole)) return res.status(400).json({ error: "invalid_role" });
  const role: "participant" | "verifier" | "admin" = requestedRole as "participant" | "verifier" | "admin";
  if (target === res.locals.userId && role !== "admin") return res.status(409).json({ error: "cannot_self_demote" });
  try {
    const db = await database();
    const [existing] = await db.select({ role: users.role }).from(users).where(eq(users.clerkUserId, target));
    if (!existing) return res.status(404).json({ error: "user_not_found" });
    await db.update(users).set({ role }).where(eq(users.clerkUserId, target));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "pilot_api_error" });
  }
});

router.get("/admin/users", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "forbidden" });
  try {
    const db = await database();
    const rows = await db.select({ clerkUserId: users.clerkUserId, role: users.role, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(100);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: "pilot_api_error" });
  }
});
export default router;

