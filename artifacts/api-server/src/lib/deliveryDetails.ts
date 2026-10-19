import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { deliveryIdForIdempotency, scanCategories, uuidPattern, type DeliveryCursor } from "./pilotPolicy.ts";

export type DeliveryStatus = "pending" | "scheduled" | "received" | "approved" | "rejected" | "cancelled";
export type DeliveryMaterialInput = { categoryCode: (typeof scanCategories)[number]; estimatedGrams: number };
export type DetailedDeliveryInput = {
  materials: DeliveryMaterialInput[];
  deliveryPointId: string;
  slotId: string | null;
};

export type PublicDelivery = {
  id: string;
  status: DeliveryStatus;
  requestVersion: 1 | 2;
  createdAt: Date;
  updatedAt: Date;
  deliveryPoint: null | {
    id: string;
    code: string;
    name: string;
    address: string;
    municipality: string;
  };
  slot: null | { id: string; startsAt: Date; endsAt: Date };
  materials: DeliveryMaterialInput[];
};

export type DeliveryOptionPoint = {
  id: string;
  code: string;
  name: string;
  address: string;
  municipality: string;
  timeZone: string;
  appointmentRequired: boolean;
  materials?: DeliveryMaterialInput["categoryCode"][];
  slots: Array<{ id: string; startsAt: Date; endsAt: Date; remainingCapacity: number }>;
};

export type DeliveryOptions = {
  mode: "legacy" | "detailed";
  enabled: boolean;
  reason: "feature_disabled" | "migration_pending" | "configuration_pending" | null;
  categories: Array<{ code: (typeof scanCategories)[number] }>;
  points: DeliveryOptionPoint[];
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type DatabaseError = Error & { code?: string; constraint?: string };

export class DeliveryRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function deliveryDetailsEnabled(value: unknown): boolean {
  return value === "true";
}

export function parseDetailedDeliveryInput(value: unknown): DetailedDeliveryInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeliveryRequestError(400, "invalid_delivery_request");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["materials", "deliveryPointId", "slotId"].includes(key))) {
    throw new DeliveryRequestError(400, "unexpected_fields");
  }
  if (!uuidPattern.test(String(record.deliveryPointId ?? ""))) {
    throw new DeliveryRequestError(400, "invalid_delivery_point");
  }
  if (record.slotId !== null && record.slotId !== undefined && !uuidPattern.test(String(record.slotId))) {
    throw new DeliveryRequestError(400, "invalid_delivery_slot");
  }
  if (!Array.isArray(record.materials) || record.materials.length < 1 || record.materials.length > 6) {
    throw new DeliveryRequestError(400, "invalid_delivery_materials");
  }

  const categories = new Set<string>();
  let totalGrams = 0;
  const materials = record.materials.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new DeliveryRequestError(400, "invalid_delivery_material");
    }
    const item = candidate as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["categoryCode", "estimatedGrams"].includes(key))) {
      throw new DeliveryRequestError(400, "unexpected_material_fields");
    }
    const categoryCode = item.categoryCode;
    const estimatedGrams = item.estimatedGrams;
    if (typeof categoryCode !== "string" || !(scanCategories as readonly string[]).includes(categoryCode)) {
      throw new DeliveryRequestError(400, "invalid_material_category");
    }
    if (categories.has(categoryCode)) {
      throw new DeliveryRequestError(400, "duplicate_material_category");
    }
    if (!Number.isSafeInteger(estimatedGrams) || (estimatedGrams as number) < 1 || (estimatedGrams as number) > 100_000) {
      throw new DeliveryRequestError(400, "invalid_estimated_quantity");
    }
    categories.add(categoryCode);
    totalGrams += estimatedGrams as number;
    return { categoryCode: categoryCode as DeliveryMaterialInput["categoryCode"], estimatedGrams: estimatedGrams as number };
  });
  if (totalGrams > 100_000) throw new DeliveryRequestError(400, "estimated_quantity_limit_exceeded");

  return {
    materials: materials.sort((left, right) => left.categoryCode.localeCompare(right.categoryCode)),
    deliveryPointId: String(record.deliveryPointId),
    slotId: record.slotId === undefined || record.slotId === null ? null : String(record.slotId),
  };
}

export function hashDeliveryIdempotencyKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashDetailedDeliveryInput(value: DetailedDeliveryInput): string {
  return createHash("sha256").update(JSON.stringify({
    deliveryPointId: value.deliveryPointId,
    slotId: value.slotId,
    materials: value.materials.map(({ categoryCode, estimatedGrams }) => ({ categoryCode, estimatedGrams })),
  }), "utf8").digest("hex");
}

function rowsOf<T>(result: QueryResult): T[] {
  return result.rows as T[];
}

export async function hasDeliveryDetailsSchema(database: Queryable): Promise<boolean> {
  const result = await database.query(`
    SELECT
      to_regclass('public.material_categories') IS NOT NULL
      AND to_regclass('public.delivery_items') IS NOT NULL
      AND to_regclass('public.delivery_points') IS NOT NULL
      AND to_regclass('public.delivery_slots') IS NOT NULL
      AND to_regclass('public.delivery_status_events') IS NOT NULL
      AND to_regclass('public.delivery_idempotency') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'deliveries' AND column_name = 'request_version'
      ) AS ready
  `);
  return rowsOf<{ ready: boolean }>(result)[0]?.ready === true;
}

export async function loadDeliveryOptions(
  database: Queryable,
  featureRequested: boolean,
): Promise<DeliveryOptions> {
  if (!featureRequested) {
    return { mode: "legacy", enabled: true, reason: "feature_disabled", categories: [], points: [] };
  }
  if (!await hasDeliveryDetailsSchema(database)) {
    return { mode: "legacy", enabled: true, reason: "migration_pending", categories: [], points: [] };
  }

  if (process.env.EVALUATION_MODE_ENABLED === "true") {
    const schema = await database.query("SELECT to_regclass('public.delivery_point_materials') IS NOT NULL AS ready");
    if (rowsOf<{ ready: boolean }>(schema)[0]?.ready !== true) {
      return { mode: "detailed", enabled: false, reason: "configuration_pending", categories: [], points: [] };
    }
  }
  const [categoryResult, pointResult, slotResult, materialResult] = await Promise.all([
    database.query(`
      SELECT code FROM material_categories
      WHERE active = true
      ORDER BY code
    `),
    database.query(`
      SELECT id, code, name, address, municipality, time_zone, appointment_required
      FROM delivery_points
      WHERE active = true
      ORDER BY name, id
      LIMIT 100
    `),
    database.query(`
      SELECT s.id, s.delivery_point_id, s.starts_at, s.ends_at,
        (s.capacity - count(d.id))::integer AS remaining_capacity
      FROM delivery_slots s
      LEFT JOIN deliveries d ON d.slot_id = s.id AND d.status NOT IN ('cancelled', 'rejected')
      WHERE s.active = true AND s.starts_at > now()
      GROUP BY s.id
      HAVING s.capacity - count(d.id) > 0
      ORDER BY s.starts_at, s.id
      LIMIT 500
    `),
    process.env.EVALUATION_MODE_ENABLED === "true"
      ? database.query("SELECT delivery_point_id, category_code FROM delivery_point_materials ORDER BY category_code")
      : Promise.resolve(null),
  ]);

  const categories = rowsOf<{ code: DeliveryMaterialInput["categoryCode"] }>(categoryResult)
    .filter((row) => (scanCategories as readonly string[]).includes(row.code));
  const materialsByPoint = new Map<string, DeliveryMaterialInput["categoryCode"][]>();
  for (const material of materialResult ? rowsOf<{ delivery_point_id: string; category_code: DeliveryMaterialInput["categoryCode"] }>(materialResult) : []) {
    if (!(scanCategories as readonly string[]).includes(material.category_code)) continue;
    const accepted = materialsByPoint.get(material.delivery_point_id) ?? [];
    accepted.push(material.category_code);
    materialsByPoint.set(material.delivery_point_id, accepted);
  }
  const slotsByPoint = new Map<string, DeliveryOptionPoint["slots"]>();
  for (const row of rowsOf<{
    id: string;
    delivery_point_id: string;
    starts_at: Date;
    ends_at: Date;
    remaining_capacity: number;
  }>(slotResult)) {
    const slots = slotsByPoint.get(row.delivery_point_id) ?? [];
    slots.push({ id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, remainingCapacity: row.remaining_capacity });
    slotsByPoint.set(row.delivery_point_id, slots);
  }
  const points = rowsOf<{
    id: string;
    code: string;
    name: string;
    address: string;
    municipality: string;
    time_zone: string;
    appointment_required: boolean;
  }>(pointResult).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    municipality: row.municipality,
    timeZone: row.time_zone,
    appointmentRequired: row.appointment_required,
    ...(materialResult ? { materials: materialsByPoint.get(row.id) ?? [] } : {}),
    slots: slotsByPoint.get(row.id) ?? [],
  }));
  const configured = categories.length > 0 && points.some((point) => point.appointmentRequired && point.slots.length > 0);
  return {
    mode: "detailed",
    enabled: configured,
    reason: configured ? null : "configuration_pending",
    categories,
    points,
  };
}

function mapPublicDeliveryRow(row: Record<string, unknown>): PublicDelivery {
  const requestVersion = Number(row.request_version);
  const materials = Array.isArray(row.materials) ? row.materials : [];
  return {
    id: String(row.id),
    status: row.status as DeliveryStatus,
    requestVersion: requestVersion === 2 ? 2 : 1,
    createdAt: row.created_at as Date,
    updatedAt: (row.updated_at ?? row.created_at) as Date,
    deliveryPoint: row.delivery_point_id ? {
      id: String(row.delivery_point_id),
      code: String(row.delivery_point_code),
      name: String(row.delivery_point_name),
      address: String(row.delivery_point_address),
      municipality: String(row.delivery_point_municipality),
    } : null,
    slot: row.slot_id ? {
      id: String(row.slot_id),
      startsAt: row.slot_starts_at as Date,
      endsAt: row.slot_ends_at as Date,
    } : null,
    materials: materials.map((item) => {
      const record = item as Record<string, unknown>;
      return { categoryCode: record.categoryCode as DeliveryMaterialInput["categoryCode"], estimatedGrams: Number(record.estimatedGrams) };
    }),
  };
}

async function findDetailedDelivery(database: Queryable, userId: string, deliveryId: string): Promise<PublicDelivery | null> {
  const result = await database.query(`
    SELECT d.id, d.status, d.request_version, d.created_at, d.updated_at,
      p.id AS delivery_point_id, p.code AS delivery_point_code, p.name AS delivery_point_name,
      p.address AS delivery_point_address, p.municipality AS delivery_point_municipality,
      s.id AS slot_id, s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'categoryCode', i.category_code,
          'estimatedGrams', i.estimated_grams
        ) ORDER BY i.category_code)
        FROM delivery_items i WHERE i.delivery_id = d.id
      ), '[]'::jsonb) AS materials
    FROM deliveries d
    LEFT JOIN delivery_points p ON p.id = d.delivery_point_id
    LEFT JOIN delivery_slots s ON s.id = d.slot_id
    WHERE d.id = $1 AND d.user_id = $2
  `, [deliveryId, userId]);
  const row = rowsOf<Record<string, unknown>>(result)[0];
  return row ? mapPublicDeliveryRow(row) : null;
}

export async function listUserDeliveries(database: Queryable, userId: string): Promise<PublicDelivery[]> {
  if (!await hasDeliveryDetailsSchema(database)) {
    const result = await database.query(`
      SELECT id, status, 1 AS request_version, created_at, created_at AS updated_at,
        NULL::uuid AS delivery_point_id, NULL::text AS delivery_point_code,
        NULL::text AS delivery_point_name, NULL::text AS delivery_point_address,
        NULL::text AS delivery_point_municipality, NULL::uuid AS slot_id,
        NULL::timestamptz AS slot_starts_at, NULL::timestamptz AS slot_ends_at,
        '[]'::jsonb AS materials
      FROM deliveries
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `, [userId]);
    return rowsOf<Record<string, unknown>>(result).map(mapPublicDeliveryRow);
  }
  const result = await database.query(`
    SELECT d.id, d.status, d.request_version, d.created_at, d.updated_at,
      p.id AS delivery_point_id, p.code AS delivery_point_code, p.name AS delivery_point_name,
      p.address AS delivery_point_address, p.municipality AS delivery_point_municipality,
      s.id AS slot_id, s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'categoryCode', i.category_code,
          'estimatedGrams', i.estimated_grams
        ) ORDER BY i.category_code)
        FROM delivery_items i WHERE i.delivery_id = d.id
      ), '[]'::jsonb) AS materials
    FROM deliveries d
    LEFT JOIN delivery_points p ON p.id = d.delivery_point_id
    LEFT JOIN delivery_slots s ON s.id = d.slot_id
    WHERE d.user_id = $1
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 50
  `, [userId]);
  return rowsOf<Record<string, unknown>>(result).map(mapPublicDeliveryRow);
}

export async function listVerifierDeliveries(
  database: Queryable,
  actorUserId: string,
  limit: number,
  cursor: DeliveryCursor | null,
): Promise<PublicDelivery[]> {
  const parameters = [actorUserId, cursor?.createdAt ?? null, cursor?.id ?? null, limit];
  if (!await hasDeliveryDetailsSchema(database)) {
    const result = await database.query(`
      SELECT d.id, d.status, 1 AS request_version, d.created_at, d.created_at AS updated_at,
        NULL::uuid AS delivery_point_id, NULL::text AS delivery_point_code,
        NULL::text AS delivery_point_name, NULL::text AS delivery_point_address,
        NULL::text AS delivery_point_municipality, NULL::uuid AS slot_id,
        NULL::timestamptz AS slot_starts_at, NULL::timestamptz AS slot_ends_at,
        '[]'::jsonb AS materials
      FROM deliveries d
      WHERE d.status = 'pending' AND d.user_id <> $1
        AND ($2::timestamptz IS NULL OR (d.created_at, d.id) < ($2::timestamptz, $3::uuid))
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $4
    `, parameters);
    return rowsOf<Record<string, unknown>>(result).map(mapPublicDeliveryRow);
  }
  const result = await database.query(`
    SELECT d.id, d.status, d.request_version, d.created_at, d.updated_at,
      p.id AS delivery_point_id, p.code AS delivery_point_code, p.name AS delivery_point_name,
      p.address AS delivery_point_address, p.municipality AS delivery_point_municipality,
      s.id AS slot_id, s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'categoryCode', i.category_code,
          'estimatedGrams', i.estimated_grams
        ) ORDER BY i.category_code)
        FROM delivery_items i WHERE i.delivery_id = d.id
      ), '[]'::jsonb) AS materials
    FROM deliveries d
    LEFT JOIN delivery_points p ON p.id = d.delivery_point_id
    LEFT JOIN delivery_slots s ON s.id = d.slot_id
    WHERE d.status IN ('pending', 'scheduled', 'received') AND d.user_id <> $1
      AND ($2::timestamptz IS NULL OR (d.created_at, d.id) < ($2::timestamptz, $3::uuid))
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT $4
  `, parameters);
  return rowsOf<Record<string, unknown>>(result).map(mapPublicDeliveryRow);
}
export async function createLegacyDelivery(
  database: Queryable,
  userId: string,
  idempotencyKey: string,
): Promise<{ delivery: PublicDelivery; replayed: boolean }> {
  const deliveryId = deliveryIdForIdempotency(userId, idempotencyKey);
  const detailedSchema = await hasDeliveryDetailsSchema(database);
  const insert = detailedSchema
    ? `INSERT INTO deliveries (id, user_id, request_version) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING RETURNING id`
    : `INSERT INTO deliveries (id, user_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`;
  const created = await database.query(insert, [deliveryId, userId]);
  const delivery = detailedSchema
    ? await findDetailedDelivery(database, userId, deliveryId)
    : (await listUserDeliveries(database, userId)).find((row) => row.id === deliveryId) ?? null;
  if (!delivery) throw new DeliveryRequestError(409, "idempotency_conflict");
  return { delivery, replayed: created.rowCount === 0 };
}

export async function createDetailedDelivery(
  pool: Pool,
  userId: string,
  idempotencyKey: string,
  input: DetailedDeliveryInput,
  options: { beforeCommit?: () => Promise<void> } = {},
): Promise<{ delivery: PublicDelivery; replayed: boolean }> {
  const keyHash = hashDeliveryIdempotencyKey(idempotencyKey);
  const requestHash = hashDetailedDeliveryInput(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([userId, "create", keyHash])]);
    const previousResult = await client.query(`
      SELECT request_hash, delivery_id, completed_at
      FROM delivery_idempotency
      WHERE user_id = $1 AND operation = 'create' AND key_hash = $2
    `, [userId, keyHash]);
    const previous = rowsOf<{ request_hash: string; delivery_id: string | null; completed_at: Date | null }>(previousResult)[0];
    if (previous) {
      if (previous.request_hash !== requestHash) {
        throw new DeliveryRequestError(409, "idempotency_key_reused");
      }
      if (!previous.delivery_id || !previous.completed_at) {
        throw new DeliveryRequestError(409, "idempotency_operation_incomplete");
      }
      const delivery = await findDetailedDelivery(client, userId, previous.delivery_id);
      if (!delivery) throw new DeliveryRequestError(409, "idempotency_conflict");
      await client.query("COMMIT");
      return { delivery, replayed: true };
    }

    await client.query(`
      INSERT INTO delivery_idempotency (user_id, operation, key_hash, request_hash)
      VALUES ($1, 'create', $2, $3)
    `, [userId, keyHash, requestHash]);

    const categoryResult = await client.query(`
      SELECT code FROM material_categories
      WHERE active = true AND code = ANY($1::text[])
    `, [input.materials.map((material) => material.categoryCode)]);
    if (categoryResult.rowCount !== input.materials.length) {
      throw new DeliveryRequestError(409, "material_category_unavailable");
    }

    const pointResult = await client.query(`
      SELECT appointment_required FROM delivery_points
      WHERE id = $1 AND active = true
    `, [input.deliveryPointId]);
    const point = rowsOf<{ appointment_required: boolean }>(pointResult)[0];
    if (!point) throw new DeliveryRequestError(409, "delivery_point_unavailable");
    if (process.env.EVALUATION_MODE_ENABLED === "true") {
      const accepted = await client.query(`SELECT category_code FROM delivery_point_materials
        WHERE delivery_point_id = $1 AND category_code = ANY($2::text[])`,
        [input.deliveryPointId, input.materials.map(material => material.categoryCode)]);
      if (accepted.rowCount !== input.materials.length) {
        throw new DeliveryRequestError(409, "material_category_unavailable");
      }
    }
    // Every V2 request needs a capacity-limited, validated time slot.
    if (!point.appointment_required || !input.slotId) {
      throw new DeliveryRequestError(409, "delivery_slot_required");
    }

    if (input.slotId) {
      const slotResult = await client.query(`
        SELECT id, capacity FROM delivery_slots
        WHERE id = $1 AND delivery_point_id = $2 AND active = true AND starts_at > now()
      `, [input.slotId, input.deliveryPointId]);
      const slot = rowsOf<{ id: string; capacity: number }>(slotResult)[0];
      if (!slot) throw new DeliveryRequestError(409, "delivery_slot_unavailable");
      const reservedResult = await client.query(`
        SELECT count(*)::integer AS count FROM deliveries
        WHERE slot_id = $1 AND status NOT IN ('cancelled', 'rejected')
      `, [input.slotId]);
      if (rowsOf<{ count: number }>(reservedResult)[0].count >= slot.capacity) {
        throw new DeliveryRequestError(409, "delivery_slot_unavailable");
      }
    }

    const deliveryId = randomUUID();
    await client.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [deliveryId, userId, input.deliveryPointId, input.slotId]);
    for (const material of input.materials) {
      await client.query(`
        INSERT INTO delivery_items (delivery_id, category_code, estimated_grams)
        VALUES ($1, $2, $3)
      `, [deliveryId, material.categoryCode, material.estimatedGrams]);
    }
    await client.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, NULL, 'pending')
    `, [randomUUID(), deliveryId, userId]);
    await client.query(`
      UPDATE delivery_idempotency
      SET delivery_id = $3, completed_at = now()
      WHERE user_id = $1 AND operation = 'create' AND key_hash = $2
    `, [userId, keyHash, deliveryId]);

    if (options.beforeCommit) await options.beforeCommit();
    const delivery = await findDetailedDelivery(client, userId, deliveryId);
    if (!delivery) throw new DeliveryRequestError(500, "delivery_creation_failed");
    await client.query("COMMIT");
    return { delivery, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof DeliveryRequestError) throw error;
    const databaseError = error as DatabaseError;
    if (databaseError.code === "23514" || databaseError.code === "23503") {
      throw new DeliveryRequestError(409, "delivery_details_conflict");
    }
    if (databaseError.code === "42501") {
      throw new DeliveryRequestError(503, "delivery_details_permissions_unavailable");
    }
    throw error;
  } finally {
    client.release();
  }
}
