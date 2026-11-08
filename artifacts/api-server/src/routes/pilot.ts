import { getAuth } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter, type Response } from "express";
import { pointMovements, scans, users, deliveries } from "@workspace/db/schema";
import { canAccessVerifierQueue, encodeDeliveryCursor, hasOnlyFields, parseDeliveryCursor, parseDeliveryPageLimit, quotaRetryAfterSeconds, scanIdForIdempotency, uuidPattern, validIdempotencyKey, validReceiptCode, validRejectionReason, validScanCategory, parsePointsPolicy, verificationActionsEnabled, type QuotaDenialReason } from "../lib/pilotPolicy";
import { canManageUsers, clerkUserIdPattern, decideRoleChange, isPilotRole } from "../lib/pilotRoles";
import { createDetailedDelivery, createLegacyDelivery, DeliveryRequestError, deliveryDetailsEnabled, hasDeliveryDetailsSchema, listUserDeliveries, listVerifierDeliveries, loadDeliveryOptions, loadPublishedDeliveryPoints, parseDetailedDeliveryInput } from "../lib/deliveryDetails";
import { DeliveryLifecycleError, receivePhysicalDelivery, updateOwnDeliveryStatus, verifyPhysicalDelivery } from "../lib/deliveryLifecycle";
import { acceptDeliveryRequest, hasDeliveryAcceptanceSchema } from "../lib/deliveryAcceptance";
import { hasCoordinationPlansSchema, parseHandoffDetails, planDeliveryHandoff } from "../lib/deliveryCoordinationPlans";
import { initializeAdminCatalog } from "../lib/adminInitialCatalog";
import { canManageCatalog, CatalogError, catalogDetailsCapabilities, createDraftPoint, createDraftSlot, deactivateCatalogRecord, hasCatalogValidationSchema, listCatalog, parseDraftPoint, parseDraftSlot, parsePointCoordinates, parsePointMaterials, parsePointEdit, parseSlotEdit, parseCatalogPublicationRequest, replaceDraftPointMaterials, updateActiveSlotCapacity, updateDraftPoint, updateDraftPointCoordinates, updateDraftSlot, validateCatalogPoint, validateCatalogSlot } from "../lib/deliveryCatalog";
import { RewardError, activateOwnedDigitalDownload, createRewardDraft, digitalAssetForFulfillment, editRewardDraft, editPublishedDigitalReward, fulfillRedemption, hasRewardFulfillmentSchema, hasRewardFulfillmentEvidence, listReservedRedemptions, parseRewardDraft, parseRewardPublication, publishRewardDraft, rewardPublicationEnabled, redeemReward, redemptionActionsEnabled } from "../lib/rewardService";
import { listFulfilledRedemptions } from "../lib/rewardService";
import { withdrawReward } from "../lib/rewardService";
import challengesRouter from "./challenges";
import { hasRewardPhotoSchema, parsePhysicalRewardPhoto, recordPhysicalRewardPhoto } from "../lib/rewardPhotos";
import { digitalAssetEvidence } from "../lib/digitalAssetRegistry";
import { hasRewardInventorySchema, listRewardInventoryMovements, parseRewardRestock, restockReward } from "../lib/rewardService";
import { adminRewardView, hasRewardDraftRecoverySchema, recoverRewardDraft } from "../lib/rewardService";
import { AiClassificationError, parseAiSuggestion, sanitizePng } from "../lib/aiClassification";
import { AiGuideError, askGuideWithProvider, parseGuideRequest } from "../lib/aiGuide";
import { digitalAssetCatalog, ownedDigitalAsset, registeredDigitalAsset } from "../lib/digitalAssets";
import { guideAccountDetails } from "../lib/aiGuideCore";
import { GuideStorageError, hasGuideStorage, listGuideConversations, createGuideConversation, readGuideConversation, deleteGuideConversation, parseStoredQuestion, answerStoredGuideQuestion } from "../lib/guideStorage";
import { AiProviderError, ProviderConfig, classifyImageWithVision } from "../lib/aiProvider";
import { resolveAiSettings, resolveAiRuntimeLimits } from "../lib/aiProviderConfig";
import { QuotaConfig, QuotaStoreError, reserveQuota, finishQuotaAttempt } from "../lib/aiQuota";
import { computeProgress } from "../lib/progressService";
import { listEvaluationTestPoints } from "../lib/evaluationPoints";
import { logger } from "../lib/logger";
import { activatePlatform, PlatformActivationError, platformStatus, readPlatformEnvironment } from "../lib/platformActivation";
import { AdminMutationError } from "../lib/adminMutation";
import { assignCoordinationRequest, cancelOwnCoordinationRequest, CoordinationError, createCoordinationRequest, hasCoordinationSchema, listAdminCoordinationRequests, listOwnCoordinationRequests, parseCoordinationAssignment, parseCoordinationInput } from "../lib/coordinationRequests";

const router: IRouter = Router();
const mutationCounts = new Map<string, { count: number; resetAt: number }>();

// Provider retries belong to the same user action, so the per-minute budget must
// allow every attempt of one analysis; otherwise the retry itself is rejected
// with a quota error and the user sees "limit reached" after a single click.
const aiRuntimeLimits = resolveAiRuntimeLimits(process.env);
const aiMaxRetries = aiRuntimeLimits.maxRetries;
const minuteAttemptFloor = aiMaxRetries + 1;

const quotaCfg: QuotaConfig = {
  store: (process.env.AI_QUOTA_STORE === "memory" ? "memory" : "file"),
  filePath: process.env.AI_QUOTA_FILE_PATH || "./storage/ai_quota.json",
  dailyGlobalFreeReq: Number(process.env.AI_DAILY_GLOBAL_FREE_REQ) || 50,
  dailyPerUserFreeReq: Number(process.env.AI_DAILY_PER_USER_FREE_REQ) || 8,
  minutePerUserEcoScan: Math.max(Number(process.env.AI_MINUTE_PER_USER_FREE_REQ) || 2, minuteAttemptFloor),
  minutePerUserEcoGuide: Math.max(Number(process.env.AI_GUIDE_MINUTE_PER_USER_FREE_REQ) || 4, minuteAttemptFloor),
  // Render kills the process on deploy/restart without cleanup; reclaim locks
  // older than any plausible request instead of failing closed forever.
  lockStaleMs: Number(process.env.AI_QUOTA_LOCK_STALE_MS) || 120_000,
};

const quotaDenialCodes: Record<QuotaDenialReason, string> = {
  global_daily: "ai_quota_global",
  user_daily: "ai_quota_daily",
  user_minute: "ai_quota_minute",
  concurrent: "ai_quota_busy",
};

function reserveAiAttempt(userId: string, kind: "ecoscan" | "ecoguide") {
  return (model: string, attempt: number) => {
    try {
      const now = Date.now();
      const result = reserveQuota(quotaCfg, userId, kind, now, { model, number: attempt });
      if (!result.ok) {
        const reason = result.reason ?? "concurrent";
        throw new AiProviderError(429, quotaDenialCodes[reason], quotaRetryAfterSeconds(reason, now));
      }
      if (!result.attemptId) throw new AiProviderError(503, "ai_quota_store_unavailable");
      return result.attemptId;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof QuotaStoreError) throw new AiProviderError(503, "ai_quota_store_unavailable");
      throw error;
    }
  };
}

// Single place that maps an AI failure to an HTTP response, including the wait
// before the client may retry (quota window or provider rate limit).
function sendAiError(res: Response, e: unknown): Response {
  const providerError = e instanceof AiProviderError ? e : null;
  const status = providerError ? providerError.status : 502;
  const code = providerError ? providerError.code : "ai_provider_unavailable";
  const retryAfterSeconds = providerError?.retryAfterSeconds;
  if (retryAfterSeconds) res.set("Retry-After", String(retryAfterSeconds));
  return res.status(status).json({ error: code, ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    ...(providerError?.diagnostic ? { diagnostic: providerError.diagnostic } : {}) });
}

function buildProviderConfig(settings: ReturnType<typeof resolveAiSettings>): ProviderConfig {
  return {
    provider: settings.provider ?? "openrouter",
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl ?? process.env.AI_BASE_URL ?? undefined,
    visionModel: settings.model,
    chatModel: settings.model,
    ...(settings.provider === "openrouter" ? { fallbackModel: "nvidia/nemotron-3.5-super-vl:free" } : {}),
    visionAllowlist: (process.env.AI_VISION_MODEL_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean),
    chatAllowlist: (process.env.AI_CHAT_MODEL_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean),
    requireOpenLicense: true,
    ...aiRuntimeLimits,
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

function platformEnvironment(res: Response): Record<string, string | undefined> {
  return res.locals.platformEnvironment ?? process.env;
}

// Favourites live in a table created by scripts/neon, not by a Drizzle
// migration, so every read/write checks it instead of failing with a 500.
async function hasFavoritesSchema(pool: Awaited<ReturnType<typeof databasePool>>) {
  const result = await pool.query<{ ready: boolean }>("SELECT to_regclass('public.favorite_centers') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}

router.use(async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) return res.status(401).json({ error: "authentication_required" });
  try {
    const db = await database();
    let [user] = await db.select({ role: users.role }).from(users).where(eq(users.clerkUserId, userId));
    if (!user) {
      await db.insert(users).values({ clerkUserId: userId }).onConflictDoNothing();
      [user] = await db.select({ role: users.role }).from(users).where(eq(users.clerkUserId, userId));
    }
    if (!user) return res.status(503).json({ error: "user_unavailable" });
    res.locals.userId = userId;
    res.locals.role = user.role;
    res.locals.platformEnvironment = await readPlatformEnvironment(await databasePool(), process.env);
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

router.use(challengesRouter);
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
  const pool = await databasePool();
  const schema = await pool.query<{ ready: boolean }>("SELECT to_regclass('public.favorite_centers') IS NOT NULL AS ready");
  if (!schema.rows[0]?.ready) return res.json({ enabled: false, ids: [], reason: "schema_pending" });
  const favorites = await pool.query<{ delivery_point_id: string }>(
    "SELECT delivery_point_id FROM favorite_centers WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [res.locals.userId]);
  return res.json({ enabled: true, ids: favorites.rows.map(row => row.delivery_point_id) });
});

router.post("/favorites/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!uuidPattern.test(id) || !hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "invalid_favorite" });
  const pool = await databasePool();
  if (!await hasFavoritesSchema(pool)) return res.status(503).json({ error: "favorites_migration_required" });
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
  const id = String(req.params.id);
  if (!uuidPattern.test(id)) return res.status(400).json({ error: "invalid_favorite" });
  const pool = await databasePool();
  if (!await hasFavoritesSchema(pool)) return res.status(503).json({ error: "favorites_migration_required" });
  await pool.query("DELETE FROM favorite_centers WHERE user_id=$1 AND delivery_point_id=$2", [res.locals.userId, id]);
  return res.sendStatus(204);
});

// Progreso educativo (EcoXP). Es una métrica de aprendizaje derivada en el servidor
// desde clasificaciones y entregas reales; no es un libro contable ni otorga EcoPuntos.
router.get("/progress", async (_req, res) => {
  const db = await database();
  const scanRows = await db.select({ category: scans.category, createdAt: scans.createdAt })
    .from(scans).where(and(eq(scans.userId, res.locals.userId), eq(scans.source, "manual")));
  const deliveryRows = await db.select({ status: deliveries.status, createdAt: deliveries.createdAt })
    .from(deliveries).where(eq(deliveries.userId, res.locals.userId));
  return res.json(computeProgress(scanRows, deliveryRows));
});

router.get("/scans/ai-capabilities", (_req, res) => {
  const settings = resolveAiSettings("ecoscan", process.env);
  return res.json({ enabled: settings.missing.length === 0, provider: settings.missing.length === 0 ? settings.provider : null, missing: settings.missing });
});
router.post("/scans/classify", async (req, res) => {
  if (req.get("X-AI-Consent") !== "true") return res.status(403).json({ error: "ai_consent_required" });
  const settings = resolveAiSettings("ecoscan", process.env);
  if (settings.missing.length) {
    return res.status(503).json({ error: "ai_provider_unconfigured" });
  }
  if (!req.is("image/png") || !Buffer.isBuffer(req.body)) return res.status(415).json({ error: "png_required" });
  let sanitized: Buffer;
  try { sanitized = sanitizePng(req.body); }
  catch (error) { return res.status(error instanceof AiClassificationError ? error.status : 400).json({ error: error instanceof AiClassificationError ? error.code : "invalid_image" }); }
  const uid = res.locals.userId;
  const cfg = buildProviderConfig(settings);
  cfg.beforeAttempt = reserveAiAttempt(uid, "ecoscan");
  cfg.afterAttempt = (id, status, durationMs, errorCode) => finishQuotaAttempt(quotaCfg, id, status, durationMs, errorCode);
  try {
    const resProv = await classifyImageWithVision(cfg, sanitized.toString("base64"));
    return res.json(resProv);
  } catch (e) {
    return sendAiError(res, e);
  }
});

// A missing chat-specific setting must not inherit a vision model or the
// unverified OpenRouter router. Use only a previously verified free chat model.
router.get("/guide/capabilities", (_req, res) => {
  const settings = resolveAiSettings("ecoguide", process.env);
  return res.json({ enabled: settings.missing.length === 0, provider: settings.missing.length === 0 ? settings.provider : null, missing: settings.missing });
});
async function answerGuideRequest(uid: string, request: ReturnType<typeof parseGuideRequest>) {
  const settings = resolveAiSettings("ecoguide", process.env);
  if (settings.missing.length) throw new AiProviderError(503,"ai_provider_unconfigured");
  const cfg = buildProviderConfig(settings);
  cfg.beforeAttempt = reserveAiAttempt(uid, "ecoguide");
  cfg.afterAttempt = (id, status, durationMs, errorCode) => finishQuotaAttempt(quotaCfg, id, status, durationMs, errorCode);
    const db = await database();
    const pool = await databasePool();
    // Same authorized account/centre readers as GET /deliveries and
    // /delivery-points. No client-supplied balance, slots or delivery data.
    const [[balanceRow], scanCount, deliveryCount, options, recentDeliveries] = await Promise.all([
      db.select({ total: sql<string>`coalesce(sum(${pointMovements.delta}), 0)::text` }).from(pointMovements).where(eq(pointMovements.userId, uid)),
      db.select({ c: sql<number>`count(*)::int` }).from(scans).where(and(eq(scans.userId, uid), eq(scans.source, "manual"))),
      db.select({ c: sql<number>`count(*)::int` }).from(deliveries).where(eq(deliveries.userId, uid)),
       loadDeliveryOptions(pool, true, true),
      listUserDeliveries(pool, uid),
    ]);
    const userContext = {
      balance: Math.trunc(Number(balanceRow?.total ?? "0")),
      scanCount: Math.trunc(Number(scanCount[0]?.c ?? 0)),
      deliveryCount: Math.trunc(Number(deliveryCount[0]?.c ?? 0)),
      activeCenters: options.points.length,
      pointsPolicyEnabled: verificationActionsEnabled((await readPlatformEnvironment(pool, process.env)).PILOT_POINTS_ENABLED),
      academic: process.env.EVALUATION_MODE_ENABLED === "true",
      ...guideAccountDetails(options, recentDeliveries),
    };
    return askGuideWithProvider(request, userContext, cfg);
}

async function guideDatabasePool() {
  const { getGuidePool } = await import("@workspace/db");
  try { return getGuidePool(); }
  catch { throw new GuideStorageError(503,"guide_storage_configuration_required"); }
}
router.post("/guide/ask", async (req, res) => {
  if (req.get("X-AI-Consent") !== "true") return res.status(403).json({ error: "ai_consent_required" });
  const request = parseGuideRequest(req.body);
  try {
    return res.json(await answerGuideRequest(res.locals.userId,request));
  } catch (e) {
    return sendAiError(res, e);
  }
});
router.get("/guide/conversations", async (_req,res) => {
  const pool = await guideDatabasePool();
  if (!await hasGuideStorage(pool)) return res.status(503).json({error:"guide_storage_migration_required"});
  return res.json({conversations:await listGuideConversations(pool,res.locals.userId)});
});
router.post("/guide/conversations", async (req,res) => {
  if (req.get("X-AI-Storage-Consent") !== "true") return res.status(403).json({error:"guide_storage_consent_required"});
  if (!hasOnlyFields(req.body,[])) return res.status(400).json({error:"unexpected_fields"});
  const result = await createGuideConversation(await guideDatabasePool(),res.locals.userId,req.get("Idempotency-Key"));
  if (result.replayed) res.set("Idempotency-Replayed","true");
  return res.status(result.replayed ? 200 : 201).json(result);
});
router.get("/guide/conversations/:id", async (req,res) => {
  return res.json(await readGuideConversation(await guideDatabasePool(),res.locals.userId,String(req.params.id)));
});
router.delete("/guide/conversations/:id", async (req,res) => {
  return res.json(await deleteGuideConversation(await guideDatabasePool(),res.locals.userId,String(req.params.id)));
});
router.post("/guide/conversations/:id/messages", async (req,res) => {
  if (req.get("X-AI-Consent") !== "true") return res.status(403).json({error:"ai_consent_required"});
  if (req.get("X-AI-Storage-Consent") !== "true") return res.status(403).json({error:"guide_storage_consent_required"});
  const question = parseStoredQuestion(req.body);
  try {
    const result = await answerStoredGuideQuestion(await guideDatabasePool(),res.locals.userId,String(req.params.id),req.get("Idempotency-Key"),question,
      request => answerGuideRequest(res.locals.userId,request));
    if (result.replayed) res.set("Idempotency-Replayed","true");
    return res.json(result);
  } catch (error) {
    if (error instanceof GuideStorageError) throw error;
    return sendAiError(res,error);
  }
});
router.get("/scans", async (_req, res) => {
  const db = await database();
  const rows = await db.select().from(scans)
    .where(and(eq(scans.userId, res.locals.userId), eq(scans.source, "manual")))
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

router.get("/admin/platform", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  return res.json({ ...await platformStatus(await databasePool(), platformEnvironment(res)), digitalAssets: digitalAssetCatalog() });
});

router.get("/admin/digital-assets/:key/download", (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const asset = registeredDigitalAsset(String(req.params.key));
  if (!asset) return res.status(404).json({ error: "digital_asset_unavailable" });
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", `attachment; filename="${asset.filename}"`);
  return res.type(asset.contentType).send(asset.content);
});
router.get("/admin/digital-assets", (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  return res.json(digitalAssetCatalog());
});

router.post("/admin/platform/activate", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (!hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "unexpected_fields" });
  return res.json(await activatePlatform(await databasePool(), res.locals.userId, req.get("Idempotency-Key"), process.env));
});

router.get("/admin/catalog", async (_req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  const validationReady = await hasCatalogValidationSchema(pool);
  const capabilities = await catalogDetailsCapabilities(pool);
  const materials = capabilities.canReadMaterials ? (await pool.query('SELECT delivery_point_id AS "pointId",category_code AS code FROM delivery_point_materials ORDER BY category_code')).rows : [];
  return res.json({ ...await listCatalog(pool, validationReady), materials, ...capabilities, editingEnabled: platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED === "true", validationReady, publishingEnabled: validationReady && platformEnvironment(res).PILOT_CATALOG_PUBLICATION_ENABLED === "true" });
});

// Prepare editable initial records exactly once. Records remain inactive until
// the administrator validates real locations, times and fulfillment availability.
router.post("/admin/catalog/initialize", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (!hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "unexpected_fields" });
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true" || platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED !== "true") {
    return res.status(503).json({ error: "catalog_initialization_disabled" });
  }
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool) || !await hasCatalogValidationSchema(pool)
      || !await hasRewardFulfillmentSchema(pool) || !(await catalogDetailsCapabilities(pool)).canEditMaterials) {
    return res.status(503).json({ error: "catalog_initialization_unavailable" });
  }
  return res.json(await initializeAdminCatalog(pool, res.locals.userId));
});

// Aggregated operational counts for administrators. Read-only: no personal
// identifiers, no exports, and no writes. Points/redemption totals reflect
// only confirmed server movements.
router.get("/admin/stats", async (_req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  const rewardSchemaReady = await hasRewardFulfillmentSchema(pool);
  const [usersRow, scansRow, deliveriesRow, redemptionsRow] = await Promise.all([
    pool.query<{ total: number }>("SELECT count(*)::integer AS total FROM users"),
    pool.query<{ total: number }>("SELECT count(*)::integer AS total FROM scans WHERE source = 'manual'"),
    pool.query<{ status: string; total: number }>("SELECT status, count(*)::integer AS total FROM deliveries GROUP BY status ORDER BY status"),
    rewardSchemaReady
      ? pool.query<{ fulfillment_status: string | null; total: number }>(
        "SELECT fulfillment_status, count(*)::integer AS total FROM redemptions GROUP BY fulfillment_status ORDER BY fulfillment_status",
      )
      : Promise.resolve({ rows: [] as Array<{ fulfillment_status: string | null; total: number }> }),
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
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  const input = parseDraftPoint(req.body);
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  return res.status(201).json(await createDraftPoint(pool, res.locals.userId, input));
});

router.post("/admin/catalog/slots", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  const input = parseDraftSlot(req.body);
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  return res.status(201).json(await createDraftSlot(pool, res.locals.userId, input));
});
router.patch("/admin/catalog/points/:id", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_point_id" });
  const input = parsePointEdit(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await updateDraftPoint(pool, res.locals.userId, String(req.params.id), input));
});
router.patch("/admin/catalog/slots/:id", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_slot_id" });
  const input = parseSlotEdit(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await updateDraftSlot(pool, res.locals.userId, String(req.params.id), input));
});
router.post("/admin/catalog/points/:id/validate", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_point_id" });
  const reference = parseCatalogPublicationRequest(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  const result = await validateCatalogPoint(pool, String(req.params.id), res.locals.userId, reference);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result.point);
});
router.post("/admin/catalog/slots/:id/validate", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_slot_id" });
  const reference = parseCatalogPublicationRequest(req.body);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  const result = await validateCatalogSlot(pool, String(req.params.id), res.locals.userId, reference);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result.slot);
});
router.patch("/admin/catalog/slots/:id/capacity", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if (!uuidPattern.test(String(req.params.id)) || !hasOnlyFields(req.body, ["capacity", "validationReference", "administratorDeclaration"])) return res.status(400).json({ error: "invalid_capacity_change" });
  const { capacity, ...publication } = req.body;
  const reference = parseCatalogPublicationRequest(publication);
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await updateActiveSlotCapacity(pool, String(req.params.id), res.locals.userId, req.body.capacity, reference));
});
router.post("/admin/catalog/:kind/:id/deactivate", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_PUBLICATION_ENABLED !== "true") return res.status(503).json({ error: "catalog_publication_disabled" });
  if ((req.params.kind !== "points" && req.params.kind !== "slots") || !uuidPattern.test(String(req.params.id)) || !hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "invalid_catalog_record" });
  const pool = await databasePool();
  if (!await hasCatalogValidationSchema(pool)) return res.status(503).json({ error: "catalog_validation_migration_required" });
  return res.json(await deactivateCatalogRecord(pool, res.locals.userId, req.params.kind, String(req.params.id)));
});
router.get("/delivery-points", async (_req, res) => {
  const pool = await databasePool();
  return res.json({ points: await loadPublishedDeliveryPoints(pool) });
});

// Evaluation-only test points. Served statically by this API (no database,
// no persistence, never mixed with published centers). They are clearly
// labelled as test data and never accept public physical deliveries.
router.get("/evaluation-points", async (_req, res) => {
  // Test points must never leak into the production catalogue. When the
  // evaluation switch is off the endpoint stays available but empty.
  if (process.env.EVALUATION_MODE_ENABLED !== "true") return res.json({ points: [], evaluation: false });
  return res.json({ points: listEvaluationTestPoints(), evaluation: true });
});
router.get("/delivery-options", async (_req, res) => {
  const pool = await databasePool();
  const options = await loadDeliveryOptions(pool, deliveryDetailsEnabled(platformEnvironment(res).PILOT_DELIVERY_DETAILS_ENABLED), true);
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
  const featureRequested = deliveryDetailsEnabled(platformEnvironment(res).PILOT_DELIVERY_DETAILS_ENABLED);
  const schemaReady = await hasDeliveryDetailsSchema(pool);
  const detailedPayload = Object.keys(req.body).length > 0;

  if (featureRequested && !schemaReady) return res.status(503).json({ error: "delivery_details_migration_required" });

  if (!detailedPayload) {
    if (featureRequested && schemaReady) {
      const options = await loadDeliveryOptions(pool, true, true);
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
  const options = await loadDeliveryOptions(pool, true, true);
  if (!options.enabled) {
    return res.status(503).json({ error: "delivery_details_configuration_unavailable" });
  }

  const input = parseDetailedDeliveryInput(req.body);
  const result = await createDetailedDelivery(pool, userId, idempotencyKey, input);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.delivery);
});
// Coordination requests are the explicit fallback when no verified center is
// available. They never claim a destination, receipt or points on their own.
router.get("/coordination-requests", async (_req, res) => {
  const pool = await databasePool();
  if (!await hasCoordinationSchema(pool)) return res.json({ items: [], schemaReady: false });
  return res.json({ items: await listOwnCoordinationRequests(pool, res.locals.userId), schemaReady: true });
});
router.post("/coordination-requests", async (req, res) => {
  if (!deliveryDetailsEnabled(platformEnvironment(res).PILOT_DELIVERY_DETAILS_ENABLED)) {
    return res.status(503).json({ error: "coordination_requests_disabled" });
  }
  if (!validIdempotencyKey(req.get("Idempotency-Key"))) {
    return res.status(400).json({ error: "invalid_idempotency_key" });
  }
  const input = parseCoordinationInput(req.body);
  const pool = await databasePool();
  if (!await hasCoordinationSchema(pool)) return res.status(503).json({ error: "coordination_migration_required" });
  const result = await createCoordinationRequest(pool, res.locals.userId, req.get("Idempotency-Key")!, input);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.request);
});
router.post("/coordination-requests/:id/cancel", async (req, res) => {
  if (!hasOnlyFields(req.body ?? {}, []) || !uuidPattern.test(String(req.params.id))) {
    return res.status(400).json({ error: "invalid_coordination_request" });
  }
  const pool = await databasePool();
  if (!await hasCoordinationSchema(pool)) return res.status(503).json({ error: "coordination_migration_required" });
  const result = await cancelOwnCoordinationRequest(pool, res.locals.userId, String(req.params.id));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});
router.get("/admin/coordination-requests", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!await hasCoordinationSchema(pool)) return res.json({ items: [], schemaReady: false });
  return res.json({ items: await listAdminCoordinationRequests(pool), schemaReady: true });
});
router.post("/admin/coordination-requests/:id/assign", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (!deliveryDetailsEnabled(platformEnvironment(res).PILOT_DELIVERY_DETAILS_ENABLED)) {
    return res.status(503).json({ error: "coordination_assignment_disabled" });
  }
  const assignment = parseCoordinationAssignment(req.body);
  const pool = await databasePool();
  if (!await hasCoordinationSchema(pool)) return res.status(503).json({ error: "coordination_migration_required" });
  const result = await assignCoordinationRequest(pool, res.locals.userId, String(req.params.id), assignment);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});

router.get("/verifier/capabilities", async (_req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) return res.status(403).json({ error: "verifier_required" });
  const pool = await databasePool();
  const schemaReady = await hasDeliveryDetailsSchema(pool);
  const policyReady = parsePointsPolicy(process.env.POINTS_PER_KG, process.env.POINTS_MAX_PER_DELIVERY) !== null;
  return res.json({
    receiptEnabled: schemaReady && verificationActionsEnabled(platformEnvironment(res).PILOT_RECEIPT_ENABLED),
    decisionEnabled: schemaReady && verificationActionsEnabled(platformEnvironment(res).PILOT_VERIFICATION_ENABLED),
    pointsEnabled: schemaReady && verificationActionsEnabled(platformEnvironment(res).PILOT_VERIFICATION_ENABLED)
      && verificationActionsEnabled(platformEnvironment(res).PILOT_POINTS_ENABLED) && policyReady,
  });
});
router.post("/deliveries/:id/schedule", async (req, res) => {
  if (!hasOnlyFields(req.body ?? {}, []) || !uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_delivery" });
  if (!deliveryDetailsEnabled(platformEnvironment(res).PILOT_DELIVERY_DETAILS_ENABLED)) return res.status(503).json({ error: "delivery_details_disabled" });
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  const result = await updateOwnDeliveryStatus(pool, res.locals.userId, String(req.params.id), "schedule");
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});
router.post("/deliveries/:id/cancel", async (req, res) => {
  if (!hasOnlyFields(req.body ?? {}, []) || !uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_delivery" });
  const pool = await databasePool();
  if (!await hasDeliveryDetailsSchema(pool)) return res.status(503).json({ error: "delivery_details_migration_required" });
  const result = await updateOwnDeliveryStatus(pool, res.locals.userId, String(req.params.id), "cancel");
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
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
  const rows = await listVerifierDeliveries(pool, res.locals.userId, limit + 1, cursor.value, res.locals.role === "admin");
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last
    ? encodeDeliveryCursor(last.createdAt, last.id)
    : null;
  return res.json({ items, nextCursor });
});
router.post("/admin/deliveries/:id/accept", async (req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) return res.status(403).json({ error: "verifier_required" });
  if (!uuidPattern.test(String(req.params.id)) || !hasOnlyFields(req.body ?? {}, [])) {
    return res.status(400).json({ error: "invalid_delivery" });
  }
  const pool = await databasePool();
  if (!await hasDeliveryAcceptanceSchema(pool)) return res.status(503).json({ error: "delivery_acceptance_migration_required" });
  const result = await acceptDeliveryRequest(pool, res.locals.userId, res.locals.role, String(req.params.id));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});

router.post("/admin/deliveries/:id/handoff", async (req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) return res.status(403).json({ error: "verifier_required" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_delivery" });
  const details = parseHandoffDetails(req.body);
  const pool = await databasePool();
  if (!await hasCoordinationPlansSchema(pool)) return res.status(503).json({ error: "delivery_handoff_migration_required" });
  const result = await planDeliveryHandoff(pool, res.locals.userId, res.locals.role, String(req.params.id), details);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});

router.post("/deliveries/:id/receive", async (req, res) => {
  if (!canAccessVerifierQueue(res.locals.role)) return res.status(403).json({ error: "verifier_required" });
  if (!verificationActionsEnabled(platformEnvironment(res).PILOT_RECEIPT_ENABLED)) {
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
  if (!verificationActionsEnabled(platformEnvironment(res).PILOT_VERIFICATION_ENABLED)) {
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
  if (decision === "approved" && !verificationActionsEnabled(platformEnvironment(res).PILOT_POINTS_ENABLED)) {
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
  const inventorySchemaReady = schemaReady && await hasRewardInventorySchema(pool);
  const recoveryReady = inventorySchemaReady && await hasRewardDraftRecoverySchema(pool);
  const recoveryPrivileges = recoveryReady ? await pool.query<{ ready: boolean }>(`SELECT
    has_table_privilege(current_user,'public.reward_draft_recoveries','SELECT') AND has_table_privilege(current_user,'public.reward_draft_recoveries','INSERT') AS ready`) : null;
  const inventoryPrivileges = inventorySchemaReady ? await pool.query<{ ready: boolean }>(`SELECT
    has_table_privilege(current_user,'public.reward_inventory_movements','SELECT') AND
    has_table_privilege(current_user,'public.reward_inventory_movements','INSERT') AS ready`) : null;
  const privileges = await pool.query<{ draft_insert: boolean; publication_update: boolean }>(`SELECT has_column_privilege(current_user,'public.rewards','title','INSERT') AS draft_insert,
    ${schemaReady ? "(SELECT bool_and(has_column_privilege(current_user,'public.rewards',c,'UPDATE')) FROM unnest(ARRAY['active','inventory_remaining','fulfillment_reference','validated_by','validated_at','updated_at']) AS cols(c))" : "false"} AS publication_update`);
  return res.json({
    canRedeem: redemptionActionsEnabled({ rewards: platformEnvironment(res).PILOT_REWARDS_ENABLED, points: platformEnvironment(res).PILOT_POINTS_ENABLED,
      fulfillment: platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, schemaReady),
    canManageDrafts: res.locals.role === "admin" && platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED === "true" && privileges.rows[0]?.draft_insert === true,
    canPublish: res.locals.role === "admin" && privileges.rows[0]?.publication_update === true && rewardPublicationEnabled({ publication: platformEnvironment(res).PILOT_REWARD_PUBLICATION_ENABLED,
      admin: platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED, rewards: platformEnvironment(res).PILOT_REWARDS_ENABLED, fulfillment: platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, schemaReady),
    canFulfill: schemaReady && res.locals.role === "admin" && platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED === "true" && platformEnvironment(res).PILOT_REWARDS_ENABLED === "true",
    canRestock: res.locals.role === "admin" && inventoryPrivileges?.rows[0]?.ready === true && privileges.rows[0]?.publication_update === true &&
      rewardPublicationEnabled({ publication: platformEnvironment(res).PILOT_REWARD_PUBLICATION_ENABLED, admin: platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED,
        rewards: platformEnvironment(res).PILOT_REWARDS_ENABLED, fulfillment: platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, inventorySchemaReady),
    inventorySchemaReady,
    canRecoverDraft: res.locals.role === "admin" && platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED === "true" &&
      privileges.rows[0]?.publication_update === true && recoveryPrivileges?.rows[0]?.ready === true,
    schemaReady,
  });
});
router.get("/rewards", async (_req, res) => {
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.json([]);
  const photosReady = await hasRewardPhotoSchema(pool);
  const rows = await pool.query(`SELECT r.id,r.title,r.description,r.cost,r.active,r.inventory_remaining AS "inventoryRemaining",
    r.fulfillment_reference,r.validated_at,r.validated_by,
    ${photosReady ? 'p.image_url AS "imageUrl"' : 'NULL::text AS "imageUrl"'}
    FROM rewards r
    ${photosReady ? 'LEFT JOIN reward_photos p ON p.reward_id=r.id AND p.product_title=r.title AND p.product_description=r.description' : ''}
    WHERE r.fulfillment_reference IS NOT NULL AND
      ((r.active=true AND r.inventory_remaining>0)
       OR (r.active=false AND r.inventory_remaining=0 AND
           r.fulfillment_reference LIKE 'https://ecopulse-3xb4.onrender.com/api/resources/digital/%'))
    ORDER BY r.created_at DESC,r.id DESC LIMIT 50`);
  return res.json(rows.rows.filter(row =>
    hasRewardFulfillmentEvidence(row.fulfillment_reference, row.validated_at, row.validated_by) &&
    (digitalAssetEvidence(row.fulfillment_reference) !== null ||
      (typeof row.imageUrl === "string" && row.imageUrl.startsWith("https://"))))
    .map(({ fulfillment_reference: _reference, validated_at: _validatedAt, validated_by: _validatedBy, ...row }) => row));
});
router.get("/admin/rewards", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.json([]);
  const inventoryReady = await hasRewardInventorySchema(pool);
  const photosReady = await hasRewardPhotoSchema(pool);
  const rows = await pool.query(`SELECT r.id,r.title,r.description,r.cost,r.active,r.inventory_remaining AS "inventoryRemaining",
    ${photosReady ? '(SELECT image_url FROM reward_photos p WHERE p.reward_id=r.id AND p.product_title=r.title AND p.product_description=r.description)' : 'NULL::text'} AS "imageUrl",
    r.fulfillment_reference IS NOT NULL AS "fulfillmentDocumented",r.validated_at IS NOT NULL AS "validationRecorded",r.created_at AS "createdAt",
    r.fulfillment_reference,r.validated_at,r.validated_by,
    (EXISTS(SELECT 1 FROM redemptions x WHERE x.reward_id=r.id) OR ${inventoryReady ? "EXISTS(SELECT 1 FROM reward_inventory_movements m WHERE m.reward_id=r.id)" : "true"}) AS "hasOperations"
    FROM rewards r ORDER BY r.created_at DESC,r.id DESC LIMIT 100`);
  return res.json(rows.rows.map(row => adminRewardView(row)));
});
router.put("/admin/rewards/:id/photo", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "reward_admin_disabled" });
  const input = parsePhysicalRewardPhoto(req.body);
  const pool = await databasePool();
  if (!await hasRewardPhotoSchema(pool)) return res.status(503).json({ error: "reward_photo_migration_required" });
  return res.json(await recordPhysicalRewardPhoto(pool, res.locals.userId, String(req.params.id), input));
});
router.post("/admin/rewards/:id/withdraw", async (req,res)=>{
  if(res.locals.role!=="admin") return res.status(403).json({error:"admin_required"});
  if(platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED!=="true") return res.status(503).json({error:"reward_admin_disabled"});
  if(!hasOnlyFields(req.body,[])) return res.status(400).json({error:"unexpected_fields"});
  return res.json(await withdrawReward(await databasePool(),res.locals.userId,String(req.params.id)));
});
router.post("/admin/rewards/:id/recover-draft", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "reward_drafts_disabled" });
  if (!hasOnlyFields(req.body ?? {}, [])) return res.status(400).json({ error: "unexpected_fields" });
  const pool = await databasePool();
  if (!await hasRewardDraftRecoverySchema(pool) || !await hasRewardInventorySchema(pool)) return res.status(503).json({ error: "reward_recovery_migration_required" });
  const result = await recoverRewardDraft(pool, res.locals.userId, String(req.params.id), req.get("Idempotency-Key"));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});
router.post("/admin/rewards", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "reward_drafts_disabled" });
  const input = parseRewardDraft(req.body);
  const pool = await databasePool();
  const result = await createRewardDraft(pool, res.locals.userId, req.header("Idempotency-Key"), input);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.reward);
});
async function hasRewardDigitalDetailEditSchema(pool: Awaited<ReturnType<typeof databasePool>>) {
  const result=await pool.query<{ready:boolean}>("SELECT to_regclass('public.reward_detail_edit_events') IS NOT NULL AS ready");
  return result.rows[0]?.ready===true;
}
router.patch("/admin/rewards/:id/published-details", async (req,res) => {
  if(res.locals.role!=="admin") return res.status(403).json({error:"admin_required"});
  if(platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED!=="true") return res.status(503).json({error:"reward_admin_disabled"});
  if(!hasOnlyFields(req.body,["expected","next"]) || !req.body.expected || !req.body.next ||
     !hasOnlyFields(req.body.next,["description","cost"])) return res.status(400).json({error:"invalid_reward_edit"});
  const expected=parseRewardDraft(req.body.expected);
  if(typeof req.body.next.description!=="string" || !Number.isSafeInteger(req.body.next.cost)) return res.status(400).json({error:"invalid_reward_edit"});
  const pool=await databasePool();
  if(!await hasRewardDigitalDetailEditSchema(pool)) return res.status(503).json({error:"reward_details_migration_required"});
  return res.json(await editPublishedDigitalReward(pool,res.locals.userId,String(req.params.id),expected,req.body.next));
});
router.patch("/admin/rewards/:id", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "reward_drafts_disabled" });
  if (!hasOnlyFields(req.body, ["expected", "next"]) || !req.body.expected || !req.body.next) return res.status(400).json({ error: "invalid_reward_edit" });
  const pool = await databasePool();
  const result = await editRewardDraft(pool, res.locals.userId, String(req.params.id), parseRewardDraft(req.body.expected), parseRewardDraft(req.body.next));
  return res.json(result);
});
router.patch("/admin/catalog/points/:id/coordinates", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_point_id" });
  const coordinates = parsePointCoordinates(req.body);
  const pool = await databasePool();
  if (!(await catalogDetailsCapabilities(pool)).canEditCoordinates) return res.status(503).json({ error: "catalog_coordinates_unavailable" });
  return res.json(await updateDraftPointCoordinates(pool, res.locals.userId, String(req.params.id), coordinates));
});
router.patch("/admin/catalog/points/:id/materials", async (req, res) => {
  if (!canManageCatalog(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_CATALOG_ADMIN_ENABLED !== "true") return res.status(503).json({ error: "catalog_editing_disabled" });
  if (!uuidPattern.test(String(req.params.id))) return res.status(400).json({ error: "invalid_point_id" });
  const materials = parsePointMaterials(req.body);
  const pool = await databasePool();
  if (!(await catalogDetailsCapabilities(pool)).canEditMaterials) return res.status(503).json({ error: "catalog_materials_unavailable" });
  return res.json(await replaceDraftPointMaterials(pool, res.locals.userId, String(req.params.id), materials));
});
router.post("/admin/rewards/:id/publish", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!rewardPublicationEnabled({ publication: platformEnvironment(res).PILOT_REWARD_PUBLICATION_ENABLED, admin: platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED,
    rewards: platformEnvironment(res).PILOT_REWARDS_ENABLED, fulfillment: platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED,
    policyReference: process.env.REWARD_POLICY_REFERENCE }, await hasRewardFulfillmentSchema(pool))) return res.status(503).json({ error: "reward_publication_disabled" });
  const result = await publishRewardDraft(pool, res.locals.userId, String(req.params.id), parseRewardPublication(req.body));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result.reward);
});
router.post("/admin/rewards/:id/restock", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const input = parseRewardRestock(req.body);
  const pool = await databasePool();
  if (!await hasRewardInventorySchema(pool)) return res.status(503).json({ error: "reward_inventory_migration_required" });
  if (!rewardPublicationEnabled({ publication: platformEnvironment(res).PILOT_REWARD_PUBLICATION_ENABLED, admin: platformEnvironment(res).PILOT_REWARD_ADMIN_ENABLED,
    rewards: platformEnvironment(res).PILOT_REWARDS_ENABLED, fulfillment: platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, await hasRewardFulfillmentSchema(pool))) {
    return res.status(503).json({ error: "reward_restock_disabled" });
  }
  const result = await restockReward(pool, res.locals.userId, String(req.params.id), req.get("Idempotency-Key"), input);
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result);
});
router.get("/admin/rewards/:id/inventory-movements", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const limit = parseDeliveryPageLimit(req.query.limit), cursor = parseDeliveryCursor(req.query.cursor);
  if (!uuidPattern.test(String(req.params.id)) || limit === null || !cursor.ok) return res.status(400).json({ error: "invalid_pagination" });
  const pool = await databasePool();
  if (!await hasRewardInventorySchema(pool)) return res.json({ items: [], nextCursor: null });
  const rows = await listRewardInventoryMovements(pool, String(req.params.id), limit + 1, cursor.value);
  const items = rows.slice(0, limit), last = items.at(-1);
  return res.json({ items, nextCursor: rows.length > limit && last ? encodeDeliveryCursor(last.createdAt, last.id) : null });
});
router.get("/redemptions", async (_req, res) => {
  const pool = await databasePool();
  const schemaReady = await hasRewardFulfillmentSchema(pool);
  const rows = await pool.query(`SELECT r.id,r.reward_id AS "rewardId",w.title AS "rewardTitle",r.cost,r.created_at AS "createdAt",
    ${schemaReady ? "r.fulfillment_status" : "'reserved'::text"} AS "fulfillmentStatus",
    ${schemaReady ? "r.fulfillment_reference" : "NULL::text"} AS fulfillment_reference,
    w.fulfillment_reference AS reward_reference
    FROM redemptions r JOIN rewards w ON w.id=r.reward_id WHERE r.user_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 50`, [res.locals.userId]);
  return res.json(rows.rows.map(({ fulfillment_reference, reward_reference, ...row }) => ({
    ...row,
    digitalPending: row.fulfillmentStatus === "reserved" && digitalAssetEvidence(reward_reference) !== null,
    digitalAsset: digitalAssetForFulfillment(row.fulfillmentStatus, fulfillment_reference),
  })));
});
router.post("/redemptions", async (req, res) => {
  const pool = await databasePool();
  const schemaReady = await hasRewardFulfillmentSchema(pool);
  if (!redemptionActionsEnabled({ rewards: platformEnvironment(res).PILOT_REWARDS_ENABLED, points: platformEnvironment(res).PILOT_POINTS_ENABLED,
    fulfillment: platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED, policyReference: process.env.REWARD_POLICY_REFERENCE }, schemaReady)) {
    return res.status(503).json({ error: "redemptions_disabled" });
  }
  if (!hasOnlyFields(req.body, ["rewardId"]) || typeof req.body.rewardId !== "string") return res.status(400).json({ error: "invalid_redemption" });
  const result = await redeemReward(pool, res.locals.userId, req.body.rewardId, req.header("Idempotency-Key"));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.status(result.replayed ? 200 : 201).json(result.redemption);
});
router.post("/redemptions/:id/activate-download", async (req, res) => {
  if (!uuidPattern.test(String(req.params.id)) || !hasOnlyFields(req.body ?? {}, [])) {
    return res.status(400).json({ error: "invalid_redemption" });
  }
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.status(503).json({ error: "reward_migration_required" });
  const result = await activateOwnedDigitalDownload(pool, res.locals.userId, String(req.params.id));
  if (result.replayed) res.set("Idempotency-Replayed", "true");
  return res.json(result);
});

router.get("/admin/redemptions", async (_req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.json([]);
  return res.json(await listReservedRedemptions(pool));
});
router.get("/admin/redemptions/history", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  const limit = parseDeliveryPageLimit(req.query.limit);
  const cursor = parseDeliveryCursor(req.query.cursor);
  if (limit === null || !cursor.ok) return res.status(400).json({ error: "invalid_pagination" });
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.json({ items: [], nextCursor: null });
  const rows = await listFulfilledRedemptions(pool, limit + 1, cursor.value);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return res.json({ items, nextCursor: rows.length > limit && last ? encodeDeliveryCursor(last.fulfilledAt, last.id) : null });
});
router.post("/admin/redemptions/:id/fulfill", async (req, res) => {
  if (res.locals.role !== "admin") return res.status(403).json({ error: "admin_required" });
  if (platformEnvironment(res).PILOT_REWARD_FULFILLMENT_ENABLED !== "true" || platformEnvironment(res).PILOT_REWARDS_ENABLED !== "true") {
    return res.status(503).json({ error: "fulfillment_disabled" });
  }
  if (!hasOnlyFields(req.body, ["reference", "pickupCode"]) || typeof req.body.reference !== "string") return res.status(400).json({ error: "invalid_fulfillment_reference" });
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.status(503).json({ error: "reward_migration_required" });
  return res.json(await fulfillRedemption(pool, res.locals.userId, String(req.params.id), req.body.reference, req.body.pickupCode));
});

// Administrative user management. Rules live in pilotRoles so they can be
// unit-tested. The read/write happen inside a transaction that locks the current
// administrator rows, otherwise two concurrent demotions could both believe a
// second administrator still existed and leave the system with none.
router.get("/admin/users", async (req, res) => {
  if (!canManageUsers(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  const after = req.query.after;
  if (after !== undefined && (typeof after !== "string" || !clerkUserIdPattern.test(after))) {
    return res.status(400).json({ error: "invalid_user_cursor" });
  }
  const pool = await databasePool();
  const [rows, admins] = await Promise.all([
    pool.query<{ clerkUserId: string; role: string; createdAt: string }>(
      `SELECT clerk_user_id AS "clerkUserId", role, created_at AS "createdAt"
       FROM users WHERE ($1::text IS NULL OR clerk_user_id > $1)
       ORDER BY clerk_user_id LIMIT 201`, [after ?? null]),
    pool.query<{ total: number }>("SELECT count(*)::integer AS total FROM users WHERE role = 'admin'"),
  ]);
  const page = rows.rows.slice(0, 200);
  return res.json({ users: page, adminCount: admins.rows[0]?.total ?? 0,
    nextCursor: rows.rows.length > 200 ? page.at(-1)?.clerkUserId ?? null : null });
});
router.get("/redemptions/:id/download", async (req, res) => {
  const pool = await databasePool();
  if (!await hasRewardFulfillmentSchema(pool)) return res.status(503).json({ error: "reward_migration_required" });
  const asset = await ownedDigitalAsset(pool, res.locals.userId, String(req.params.id));
  if (!asset) return res.status(404).json({ error: "digital_asset_unavailable" });
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", `attachment; filename="${asset.filename}"`);
  return res.type(asset.contentType).send(asset.content);
});

router.patch("/admin/users/:clerkUserId/role", async (req, res) => {
  if (!canManageUsers(res.locals.role)) return res.status(403).json({ error: "admin_required" });
  const target = String(req.params.clerkUserId || "").trim();
  if (!clerkUserIdPattern.test(target)) return res.status(400).json({ error: "invalid_target" });
  if (!hasOnlyFields(req.body ?? {}, ["role"])) return res.status(400).json({ error: "unexpected_fields" });
  const requestedRole = req.body?.role;
  if (!isPilotRole(requestedRole)) return res.status(400).json({ error: "invalid_role" });

  const db = await database();
  const outcome = await db.transaction(async (tx) => {
    // Serialize role changes and recheck the actor after acquiring the lock.
    // Otherwise a concurrently demoted admin could still change another role.
    // Advisory lock avoids requiring table-wide UPDATE privileges: the app
    // intentionally has only UPDATE(role), and all API role changes share it.
    await tx.execute(sql`select pg_advisory_xact_lock(170101, 1)`);
    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.clerkUserId, res.locals.userId));
    if (actor?.role !== "admin") return { denied: true as const };
    const [existing] = await tx.select({ role: users.role }).from(users).where(eq(users.clerkUserId, target));
    if (!existing) return { missing: true as const };
    // Aggregates cannot use FOR UPDATE, so lock each administrator row and count
    // the rows the transaction actually sees.
    const adminRows = await tx.execute(sql`select clerk_user_id from users where role = 'admin' for update`);
    const decision = decideRoleChange({
      actorId: res.locals.userId,
      targetId: target,
      currentRole: existing.role,
      requestedRole,
      adminCount: adminRows.rows.length,
    });
    if (decision.ok && !decision.noop) {
      // Fail closed: no committed privilege change without its audit record.
      await tx.execute(sql`insert into role_change_events
        (actor_clerk_user_id, target_clerk_user_id, previous_role, next_role)
        values (${res.locals.userId}, ${target}, ${existing.role}::user_role, ${decision.nextRole}::user_role)`);
      await tx.update(users).set({ role: decision.nextRole }).where(eq(users.clerkUserId, target));
    }
    return { decision, previousRole: existing.role };
  });

  if ("denied" in outcome) return res.status(403).json({ error: "admin_required" });
  if ("missing" in outcome) return res.status(404).json({ error: "user_not_found" });
  if (!outcome.decision.ok) return res.status(outcome.decision.status).json({ error: outcome.decision.code });

  return res.json({
    ok: true,
    user: { clerkUserId: target, role: outcome.decision.nextRole },
    changed: !outcome.decision.noop,
    auditRecorded: !outcome.decision.noop,
  });
});

const pilotErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const dbError = error?.cause ?? error;
  if (dbError?.code === "42P01") return res.status(503).json({ error: "schema_migration_required" });
  if (dbError?.code === "42501") return res.status(503).json({ error: "permissions_unavailable" });
  if (dbError?.code === "55P03" || dbError?.code === "57014") return res.status(503).json({ error: "operation_temporarily_unavailable" });
  if (error instanceof AdminMutationError || error instanceof PlatformActivationError || error instanceof DeliveryRequestError || error instanceof DeliveryLifecycleError || error instanceof CatalogError || error instanceof RewardError || error instanceof CoordinationError || error instanceof AiClassificationError || error instanceof AiGuideError || error instanceof GuideStorageError) {
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

export default router;

