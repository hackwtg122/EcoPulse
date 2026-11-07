import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { coordinationIdForIdempotency, scanCategories, uuidPattern } from "./pilotPolicy.ts";
import { hasOperationalEvidence } from "./deliveryDetails.ts";

export type CoordinationStatus = "pending" | "assigned" | "cancelled";
export type CoordinationMaterial = { categoryCode: (typeof scanCategories)[number]; estimatedGrams: number };
export type CoordinationInput = { materials: CoordinationMaterial[]; note: string | null };
export type CoordinationEvent = {
  fromStatus: CoordinationStatus | null;
  toStatus: CoordinationStatus;
  reasonCode: string | null;
  createdAt: Date;
};
export type PublicCoordinationRequest = {
  id: string;
  status: CoordinationStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  materials: CoordinationMaterial[];
  events: CoordinationEvent[];
  deliveryId: string | null;
  deliveryStatus: string | null;
  assignedPoint: null | { id: string; code: string; name: string; municipality: string };
  accountId?: string;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;
type DatabaseError = Error & { code?: string; constraint?: string };

export class CoordinationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function rowsOf<T>(result: QueryResult): T[] {
  return result.rows as T[];
}

function isCategory(value: unknown): value is CoordinationMaterial["categoryCode"] {
  return typeof value === "string" && (scanCategories as readonly string[]).includes(value);
}

export function parseCoordinationInput(value: unknown): CoordinationInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CoordinationError(400, "invalid_coordination_request");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["materials", "note"].includes(key))) {
    throw new CoordinationError(400, "unexpected_fields");
  }
  if (!Array.isArray(record.materials) || record.materials.length < 1 || record.materials.length > 6) {
    throw new CoordinationError(400, "invalid_coordination_materials");
  }
  const categories = new Set<string>();
  let totalGrams = 0;
  const materials = record.materials.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new CoordinationError(400, "invalid_coordination_material");
    }
    const item = candidate as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["categoryCode", "estimatedGrams"].includes(key))) {
      throw new CoordinationError(400, "unexpected_material_fields");
    }
    if (!isCategory(item.categoryCode)) throw new CoordinationError(400, "invalid_material_category");
    if (categories.has(item.categoryCode)) throw new CoordinationError(400, "duplicate_material_category");
    const grams = item.estimatedGrams;
    if (!Number.isSafeInteger(grams) || (grams as number) < 1 || (grams as number) > 100_000) {
      throw new CoordinationError(400, "invalid_estimated_quantity");
    }
    categories.add(item.categoryCode);
    totalGrams += grams as number;
    return { categoryCode: item.categoryCode, estimatedGrams: grams as number };
  });
  if (totalGrams > 100_000) throw new CoordinationError(400, "estimated_quantity_limit_exceeded");
  const note = record.note === undefined || record.note === null
    ? null
    : typeof record.note === "string" ? record.note.trim() : undefined;
  if (note === undefined || (note !== null && (note.length < 1 || note.length > 500))) {
    throw new CoordinationError(400, "invalid_coordination_note");
  }
  return {
    materials: materials.sort((left, right) => left.categoryCode.localeCompare(right.categoryCode)),
    note,
  };
}

export function hashCoordinationInput(input: CoordinationInput): string {
  return createHash("sha256").update(JSON.stringify({
    note: input.note,
    materials: input.materials.map(({ categoryCode, estimatedGrams }) => ({ categoryCode, estimatedGrams })),
  }), "utf8").digest("hex");
}

export async function hasCoordinationSchema(database: Queryable): Promise<boolean> {
  const result = await database.query(`
    SELECT to_regclass('public.coordination_requests') IS NOT NULL
      AND to_regclass('public.coordination_request_items') IS NOT NULL
      AND to_regclass('public.coordination_request_events') IS NOT NULL
      AND to_regclass('public.delivery_point_materials') IS NOT NULL AS ready
  `);
  return rowsOf<{ ready: boolean }>(result)[0]?.ready === true;
}

function mapRow(row: Record<string, unknown>, includeAccount = false): PublicCoordinationRequest {
  const materials = Array.isArray(row.materials) ? row.materials : [];
  const events = Array.isArray(row.events) ? row.events : [];
  return {
    id: String(row.id),
    status: row.status as CoordinationStatus,
    note: row.note === null || row.note === undefined ? null : String(row.note),
    createdAt: row.created_at as Date,
    updatedAt: (row.updated_at ?? row.created_at) as Date,
    materials: materials.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        categoryCode: record.categoryCode as CoordinationMaterial["categoryCode"],
        estimatedGrams: Number(record.estimatedGrams),
      };
    }),
    events: events.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        fromStatus: (record.fromStatus ?? null) as CoordinationStatus | null,
        toStatus: record.toStatus as CoordinationStatus,
        reasonCode: record.reasonCode === null || record.reasonCode === undefined ? null : String(record.reasonCode),
        createdAt: record.createdAt as Date,
      };
    }),
    deliveryId: row.delivery_id === null || row.delivery_id === undefined ? null : String(row.delivery_id),
    deliveryStatus: row.delivery_status === null || row.delivery_status === undefined ? null : String(row.delivery_status),
    assignedPoint: row.assigned_point_id
      ? {
        id: String(row.assigned_point_id),
        code: String(row.point_code),
        name: String(row.point_name),
        municipality: String(row.point_municipality),
      }
      : null,
    ...(includeAccount ? { accountId: String(row.user_id) } : {}),
  };
}

async function findCoordinationRequest(
  database: Queryable,
  id: string,
  options: { userId?: string; includeAccount?: boolean } = {},
): Promise<PublicCoordinationRequest | null> {
  const result = await database.query(`
    SELECT r.id, r.user_id, r.status, r.note, r.created_at, r.updated_at,
      r.delivery_id, r.assigned_point_id,
      p.code AS point_code, p.name AS point_name, p.municipality AS point_municipality,
      d.status AS delivery_status,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'categoryCode', i.category_code,
          'estimatedGrams', i.estimated_grams
        ) ORDER BY i.category_code)
        FROM coordination_request_items i WHERE i.request_id = r.id
      ), '[]'::jsonb) AS materials,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'fromStatus', e.from_status,
          'toStatus', e.to_status,
          'reasonCode', e.reason_code,
          'createdAt', e.created_at
        ) ORDER BY e.created_at, e.id)
        FROM coordination_request_events e WHERE e.request_id = r.id
      ), '[]'::jsonb) AS events
    FROM coordination_requests r
    LEFT JOIN delivery_points p ON p.id = r.assigned_point_id
    LEFT JOIN deliveries d ON d.id = r.delivery_id
    WHERE r.id = $1 ${options.userId ? "AND r.user_id = $2" : ""}
  `, options.userId ? [id, options.userId] : [id]);
  const row = rowsOf<Record<string, unknown>>(result)[0];
  return row ? mapRow(row, options.includeAccount === true) : null;
}

export async function listOwnCoordinationRequests(database: Queryable, userId: string): Promise<PublicCoordinationRequest[]> {
  if (!await hasCoordinationSchema(database)) return [];
  const result = await database.query(`
    SELECT r.id, r.user_id, r.status, r.note, r.created_at, r.updated_at,
      r.delivery_id, r.assigned_point_id,
      p.code AS point_code, p.name AS point_name, p.municipality AS point_municipality,
      d.status AS delivery_status,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'categoryCode', i.category_code,
          'estimatedGrams', i.estimated_grams
        ) ORDER BY i.category_code)
        FROM coordination_request_items i WHERE i.request_id = r.id
      ), '[]'::jsonb) AS materials,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'fromStatus', e.from_status,
          'toStatus', e.to_status,
          'reasonCode', e.reason_code,
          'createdAt', e.created_at
        ) ORDER BY e.created_at, e.id)
        FROM coordination_request_events e WHERE e.request_id = r.id
      ), '[]'::jsonb) AS events
    FROM coordination_requests r
    LEFT JOIN delivery_points p ON p.id = r.assigned_point_id
    LEFT JOIN deliveries d ON d.id = r.delivery_id
    WHERE r.user_id = $1
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 50
  `, [userId]);
  return rowsOf<Record<string, unknown>>(result).map((row) => mapRow(row));
}

export async function listAdminCoordinationRequests(database: Queryable): Promise<PublicCoordinationRequest[]> {
  if (!await hasCoordinationSchema(database)) return [];
  const result = await database.query(`
    SELECT r.id, r.user_id, r.status, r.note, r.created_at, r.updated_at,
      r.delivery_id, r.assigned_point_id,
      p.code AS point_code, p.name AS point_name, p.municipality AS point_municipality,
      d.status AS delivery_status,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'categoryCode', i.category_code,
          'estimatedGrams', i.estimated_grams
        ) ORDER BY i.category_code)
        FROM coordination_request_items i WHERE i.request_id = r.id
      ), '[]'::jsonb) AS materials,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'fromStatus', e.from_status,
          'toStatus', e.to_status,
          'reasonCode', e.reason_code,
          'createdAt', e.created_at
        ) ORDER BY e.created_at, e.id)
        FROM coordination_request_events e WHERE e.request_id = r.id
      ), '[]'::jsonb) AS events
    FROM coordination_requests r
    LEFT JOIN delivery_points p ON p.id = r.assigned_point_id
    LEFT JOIN deliveries d ON d.id = r.delivery_id
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC
    LIMIT 100
  `);
  return rowsOf<Record<string, unknown>>(result).map((row) => mapRow(row, true));
}

export async function createCoordinationRequest(
  pool: Pool,
  userId: string,
  idempotencyKey: string,
  input: CoordinationInput,
): Promise<{ request: PublicCoordinationRequest; replayed: boolean }> {
  const id = coordinationIdForIdempotency(userId, idempotencyKey);
  const requestHash = hashCoordinationInput(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(`
      INSERT INTO coordination_requests (id, user_id, status, note, request_hash)
      VALUES ($1, $2, 'pending', $3, $4)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, [id, userId, input.note, requestHash]);

    if (!inserted.rowCount) {
      const prior = await client.query<{ user_id: string; request_hash: string }>(
        "SELECT user_id, request_hash FROM coordination_requests WHERE id = $1", [id],
      );
      const row = prior.rows[0];
      if (!row || row.user_id !== userId) throw new CoordinationError(409, "idempotency_conflict");
      if (row.request_hash !== requestHash) throw new CoordinationError(409, "idempotency_key_reused");
      const request = await findCoordinationRequest(client, id, { userId });
      await client.query("COMMIT");
      if (!request) throw new CoordinationError(409, "idempotency_conflict");
      return { request, replayed: true };
    }

    const categories = await client.query<{ code: string }>(`
      SELECT code FROM material_categories
      WHERE active = true AND code = ANY($1::text[])
    `, [input.materials.map((material) => material.categoryCode)]);
    if (categories.rowCount !== input.materials.length) {
      throw new CoordinationError(409, "material_category_unavailable");
    }
    for (const material of input.materials) {
      await client.query(`
        INSERT INTO coordination_request_items (request_id, category_code, estimated_grams)
        VALUES ($1, $2, $3)
      `, [id, material.categoryCode, material.estimatedGrams]);
    }
    await client.query(`
      INSERT INTO coordination_request_events (id, request_id, actor_user_id, from_status, to_status, reason_code)
      VALUES ($1, $2, $3, NULL, 'pending', 'requested')
    `, [randomUUID(), id, userId]);
    const request = await findCoordinationRequest(client, id, { userId });
    if (!request) throw new CoordinationError(500, "coordination_creation_failed");
    await client.query("COMMIT");
    return { request, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof CoordinationError) throw error;
    const databaseError = error as DatabaseError;
    if (databaseError.code === "23514" || databaseError.code === "23503") {
      throw new CoordinationError(409, "coordination_conflict");
    }
    if (databaseError.code === "42501") throw new CoordinationError(503, "coordination_permissions_unavailable");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelOwnCoordinationRequest(
  pool: Pool,
  userId: string,
  requestId: string,
): Promise<{ requestId: string; status: "cancelled"; replayed: boolean }> {
  if (!uuidPattern.test(requestId)) throw new CoordinationError(400, "invalid_coordination_request");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ user_id: string; status: CoordinationStatus }>(
      "SELECT user_id, status FROM coordination_requests WHERE id = $1 FOR UPDATE", [requestId],
    );
    const request = result.rows[0];
    if (!request || request.user_id !== userId) throw new CoordinationError(404, "coordination_request_not_found");
    if (request.status === "cancelled") {
      await client.query("COMMIT");
      return { requestId, status: "cancelled", replayed: true };
    }
    if (request.status !== "pending") throw new CoordinationError(409, "coordination_already_assigned");
    await client.query(`
      INSERT INTO coordination_request_events (id, request_id, actor_user_id, from_status, to_status, reason_code)
      VALUES ($1, $2, $3, 'pending', 'cancelled', 'participant_cancelled')
    `, [randomUUID(), requestId, userId]);
    await client.query("UPDATE coordination_requests SET status = 'cancelled', updated_at = now() WHERE id = $1", [requestId]);
    await client.query("COMMIT");
    return { requestId, status: "cancelled", replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof CoordinationError) throw error;
    if ((error as DatabaseError).code === "42501") throw new CoordinationError(503, "coordination_permissions_unavailable");
    throw error;
  } finally {
    client.release();
  }
}

export type CoordinationAssignment = { deliveryPointId: string; slotId: string | null };

export function parseCoordinationAssignment(value: unknown): CoordinationAssignment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CoordinationError(400, "invalid_coordination_assignment");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["deliveryPointId", "slotId"].includes(key))) {
    throw new CoordinationError(400, "unexpected_fields");
  }
  if (!uuidPattern.test(String(record.deliveryPointId ?? ""))) {
    throw new CoordinationError(400, "invalid_delivery_point");
  }
  if (record.slotId !== null && record.slotId !== undefined && !uuidPattern.test(String(record.slotId))) {
    throw new CoordinationError(400, "invalid_delivery_slot");
  }
  return {
    deliveryPointId: String(record.deliveryPointId),
    slotId: record.slotId === undefined || record.slotId === null ? null : String(record.slotId),
  };
}

export async function assignCoordinationRequest(
  pool: Pool,
  actorId: string,
  requestId: string,
  assignment: CoordinationAssignment,
): Promise<{ request: PublicCoordinationRequest; deliveryId: string; replayed: boolean }> {
  if (!uuidPattern.test(requestId)) throw new CoordinationError(400, "invalid_coordination_request");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serializes destination changes with role revocation for the whole write.
    const actor = await client.query<{ role: string }>("SELECT role FROM users WHERE clerk_user_id = $1 FOR SHARE", [actorId]);
    if (actor.rows[0]?.role !== "admin") throw new CoordinationError(403, "admin_required");

    const result = await client.query<{
      user_id: string; status: CoordinationStatus; delivery_id: string | null;
      assigned_point_id: string | null; slot_id: string | null;
    }>(`
      SELECT r.user_id, r.status, r.delivery_id, r.assigned_point_id, d.slot_id
      FROM coordination_requests r
      LEFT JOIN deliveries d ON d.id = r.delivery_id
      WHERE r.id = $1 FOR UPDATE OF r
    `, [requestId]);
    const request = result.rows[0];
    if (!request) throw new CoordinationError(404, "coordination_request_not_found");
    if (request.status === "cancelled") throw new CoordinationError(409, "coordination_cancelled");
    if (request.status === "assigned") {
      if (request.assigned_point_id !== assignment.deliveryPointId || request.slot_id !== assignment.slotId) {
        throw new CoordinationError(409, "coordination_already_assigned");
      }
      const current = await findCoordinationRequest(client, requestId, { includeAccount: true });
      await client.query("COMMIT");
      if (!current) throw new CoordinationError(409, "coordination_already_assigned");
      return { request: current, deliveryId: String(request.delivery_id), replayed: true };
    }

    const pointResult = await client.query<{
      appointment_required: boolean; active: boolean;
      validation_reference: string | null; validated_by: string | null; validated_at: Date | null;
    }>(`
      SELECT appointment_required, active, validation_reference, validated_by, validated_at
      FROM delivery_points WHERE id = $1 FOR SHARE
    `, [assignment.deliveryPointId]);
    const point = pointResult.rows[0];
    if (!point?.active || !hasOperationalEvidence(point)) {
      throw new CoordinationError(409, "delivery_point_unavailable");
    }
    if (point.appointment_required && !assignment.slotId) {
      throw new CoordinationError(409, "delivery_slot_required");
    }
    if (!point.appointment_required && assignment.slotId) {
      throw new CoordinationError(409, "delivery_slot_not_applicable");
    }

    const accepted = await client.query<{ category_code: string }>(
      "SELECT category_code FROM delivery_point_materials WHERE delivery_point_id = $1",
      [assignment.deliveryPointId],
    );
    const acceptedCodes = new Set(accepted.rows.map((row) => row.category_code));
    const requested = await client.query<{ category_code: string; estimated_grams: number }>(
      "SELECT category_code, estimated_grams FROM coordination_request_items WHERE request_id = $1",
      [requestId],
    );
    if (!requested.rowCount || requested.rows.some((row) => !acceptedCodes.has(row.category_code))) {
      throw new CoordinationError(409, "material_category_unavailable");
    }

    if (assignment.slotId) {
      const slot = await client.query<{
        validation_reference: string | null; validated_by: string | null; validated_at: Date | null;
      }>(`
        SELECT validation_reference, validated_by, validated_at
        FROM delivery_slots
        WHERE id = $1 AND delivery_point_id = $2 AND active = true AND starts_at > now()
        FOR SHARE
      `, [assignment.slotId, assignment.deliveryPointId]);
      if (!slot.rows[0] || !hasOperationalEvidence(slot.rows[0])) {
        throw new CoordinationError(409, "delivery_slot_unavailable");
      }
    }

    const deliveryId = randomUUID();
    await client.query(`
      INSERT INTO deliveries (id, user_id, request_version, delivery_point_id, slot_id)
      VALUES ($1, $2, 2, $3, $4)
    `, [deliveryId, request.user_id, assignment.deliveryPointId, assignment.slotId]);
    for (const material of requested.rows) {
      await client.query(`
        INSERT INTO delivery_items (delivery_id, category_code, estimated_grams)
        VALUES ($1, $2, $3)
      `, [deliveryId, material.category_code, material.estimated_grams]);
    }
    await client.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status)
      VALUES ($1, $2, $3, NULL, 'pending')
    `, [randomUUID(), deliveryId, request.user_id]);
    await client.query(`
      INSERT INTO coordination_request_events (id, request_id, actor_user_id, from_status, to_status, reason_code)
      VALUES ($1, $2, $3, 'pending', 'assigned', 'center_assigned')
    `, [randomUUID(), requestId, actorId]);
    await client.query(`
      UPDATE coordination_requests
      SET status = 'assigned', delivery_id = $2, assigned_point_id = $3, assigned_by = $4, assigned_at = now(), updated_at = now()
      WHERE id = $1
    `, [requestId, deliveryId, assignment.deliveryPointId, actorId]);

    const current = await findCoordinationRequest(client, requestId, { includeAccount: true });
    if (!current) throw new CoordinationError(500, "coordination_assignment_failed");
    await client.query("COMMIT");
    return { request: current, deliveryId, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof CoordinationError) throw error;
    const databaseError = error as DatabaseError;
    if (databaseError.code === "23514" || databaseError.code === "23503" || databaseError.code === "23505") {
      throw new CoordinationError(409, "coordination_assignment_conflict");
    }
    if (databaseError.code === "42501") throw new CoordinationError(503, "coordination_permissions_unavailable");
    throw error;
  } finally {
    client.release();
  }
}
