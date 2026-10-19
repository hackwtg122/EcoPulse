import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export function canManageCatalog(role: unknown): boolean { return role === "admin"; }

export class CatalogError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogError(400, "invalid_catalog_request");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !fields.includes(key))) throw new CatalogError(400, "unexpected_fields");
  return input;
}

function boundedText(value: unknown, min: number, max: number, code: string): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CatalogError(400, code);
  }
  return value;
}

export type DraftPoint = {
  code: string;
  name: string;
  address: string;
  municipality: string;
  timeZone: string;
  appointmentRequired: boolean;
};

export function parseDraftPoint(value: unknown): DraftPoint {
  const input = record(value, ["code", "name", "address", "municipality", "timeZone", "appointmentRequired"]);
  const code = boundedText(input.code, 3, 64, "invalid_point_code");
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(code)) throw new CatalogError(400, "invalid_point_code");
  const name = boundedText(input.name, 1, 160, "invalid_point_name");
  const address = boundedText(input.address, 1, 240, "invalid_point_address");
  const municipality = boundedText(input.municipality, 1, 120, "invalid_point_municipality");
  const timeZone = boundedText(input.timeZone, 1, 64, "invalid_point_timezone");
  if (timeZone !== "America/Bogota") throw new CatalogError(400, "unsupported_point_timezone");
  if (typeof input.appointmentRequired !== "boolean") throw new CatalogError(400, "invalid_appointment_policy");
  return { code, name, address, municipality, timeZone, appointmentRequired: input.appointmentRequired };
}

export type DraftSlot = { pointId: string; startsAt: Date; endsAt: Date; capacity: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const offsetDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function parseDraftSlot(value: unknown, now = new Date()): DraftSlot {
  const input = record(value, ["pointId", "startsAt", "endsAt", "capacity"]);
  if (typeof input.pointId !== "string" || !uuid.test(input.pointId)) throw new CatalogError(400, "invalid_point_id");
  if (typeof input.startsAt !== "string" || !offsetDate.test(input.startsAt) || typeof input.endsAt !== "string" || !offsetDate.test(input.endsAt)) {
    throw new CatalogError(400, "invalid_slot_time");
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!Number.isFinite(startsAt.valueOf()) || !Number.isFinite(endsAt.valueOf()) || startsAt <= now || endsAt <= startsAt || endsAt.valueOf() - startsAt.valueOf() > 8 * 60 * 60 * 1000) {
    throw new CatalogError(400, "invalid_slot_window");
  }
  if (typeof input.capacity !== "number" || !Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 1000) {
    throw new CatalogError(400, "invalid_slot_capacity");
  }
  return { pointId: input.pointId, startsAt, endsAt, capacity: input.capacity };
}

export async function listCatalog(pool: Pool, validationReady: boolean) {
  const pointEvidence = validationReady
    ? 'validation_reference AS "validationReference", validated_at AS "validatedAt"'
    : 'NULL::text AS "validationReference", NULL::timestamptz AS "validatedAt"';
  const slotEvidence = validationReady
    ? 's.validation_reference AS "validationReference", s.validated_at AS "validatedAt"'
    : 'NULL::text AS "validationReference", NULL::timestamptz AS "validatedAt"';
  const [points, slots] = await Promise.all([
    pool.query(`SELECT id, code, name, address, municipality, time_zone AS "timeZone", appointment_required AS "appointmentRequired", active, ${pointEvidence}, created_at AS "createdAt" FROM delivery_points ORDER BY created_at DESC, id DESC LIMIT 100`),
    pool.query(`SELECT s.id, s.delivery_point_id AS "pointId", s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.capacity, s.active, ${slotEvidence}, (s.capacity - count(d.id))::integer AS "remainingCapacity" FROM delivery_slots s LEFT JOIN deliveries d ON d.slot_id = s.id AND d.status NOT IN ('cancelled', 'rejected') GROUP BY s.id ORDER BY s.starts_at DESC LIMIT 500`),
  ]);
  return { points: points.rows, slots: slots.rows };
}

export async function createDraftPoint(pool: Pool, input: DraftPoint) {
  try {
    const result = await pool.query(`INSERT INTO delivery_points (id, code, name, address, municipality, time_zone, appointment_required) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, code, name, address, municipality, time_zone AS "timeZone", appointment_required AS "appointmentRequired", active`, [randomUUID(), input.code, input.name, input.address, input.municipality, input.timeZone, input.appointmentRequired]);
    return result.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new CatalogError(409, "point_code_exists");
    throw error;
  }
}

export async function createDraftSlot(pool: Pool, input: DraftSlot) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.pointId]);
    const point = await client.query(`SELECT id, appointment_required FROM delivery_points WHERE id = $1`, [input.pointId]);
    if (!point.rowCount) throw new CatalogError(404, "point_not_found");
    if (!point.rows[0].appointment_required) throw new CatalogError(409, "point_does_not_use_slots");
    const overlapping = await client.query(`SELECT id FROM delivery_slots WHERE delivery_point_id = $1 AND starts_at < $3 AND ends_at > $2 LIMIT 1`, [input.pointId, input.startsAt, input.endsAt]);
    if (overlapping.rowCount) throw new CatalogError(409, "slot_window_overlaps");
    const result = await client.query(`INSERT INTO delivery_slots (id, delivery_point_id, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4, $5) RETURNING id, delivery_point_id AS "pointId", starts_at AS "startsAt", ends_at AS "endsAt", capacity, active`, [randomUUID(), input.pointId, input.startsAt, input.endsAt, input.capacity]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") throw new CatalogError(409, "slot_window_exists");
    throw error;
  } finally {
    client.release();
  }
}
export function parsePointEdit(value: unknown): Omit<DraftPoint, "code"> {
  const input = record(value, ["name", "address", "municipality", "timeZone", "appointmentRequired"]);
  const parsed = parseDraftPoint({ ...input, code: "existing-point" });
  const { code: _code, ...edit } = parsed;
  return edit;
}

export function parseSlotEdit(value: unknown): Omit<DraftSlot, "pointId"> {
  const input = record(value, ["startsAt", "endsAt", "capacity"]);
  const parsed = parseDraftSlot({ ...input, pointId: "00000000-0000-4000-8000-000000000000" });
  const { pointId: _pointId, ...edit } = parsed;
  return edit;
}

export function parseValidationReference(value: unknown): string {
  const input = record(value, ["validationReference"]);
  const reference = boundedText(input.validationReference, 10, 500, "invalid_validation_reference");
  let source: URL;
  try { source = new URL(reference); }
  catch { throw new CatalogError(400, "invalid_validation_reference"); }
  // Store a direct public evidence URL, never a private host or embedded credentials.
  const host = source.hostname.toLowerCase();
  if (source.protocol !== "https:" || source.username || source.password || source.hash
    || !host.includes(".") || host === "localhost" || host.endsWith(".local")
    || /^\d+(?:\.\d+){3}$/u.test(host) || host.startsWith("[")
    || source.href !== reference) {
    throw new CatalogError(400, "invalid_validation_reference");
  }
  return reference;
}

export async function hasCatalogValidationSchema(pool: Pool): Promise<boolean> {
  const result = await pool.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_points' AND column_name = 'validated_at')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_slots' AND column_name = 'validated_at') AS ready`);
  return result.rows[0]?.ready === true;
}

function catalogConflict(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === "23514" || code === "23505" || code === "23503") throw new CatalogError(409, "catalog_constraint_conflict");
  throw error;
}

export async function updateDraftPoint(pool: Pool, id: string, input: Omit<DraftPoint, "code">) {
  try {
    const result = await pool.query(`UPDATE delivery_points SET name = $2, address = $3, municipality = $4, time_zone = $5, appointment_required = $6
      WHERE id = $1 AND active = false RETURNING id, code, name, address, municipality, time_zone AS "timeZone", appointment_required AS "appointmentRequired", active`,
      [id, input.name, input.address, input.municipality, input.timeZone, input.appointmentRequired]);
    if (!result.rowCount) throw new CatalogError(409, "point_not_editable");
    return result.rows[0];
  } catch (error) { catalogConflict(error); }
}

export async function updateDraftSlot(pool: Pool, id: string, input: Omit<DraftSlot, "pointId">) {
  try {
    const result = await pool.query(`UPDATE delivery_slots SET starts_at = $2, ends_at = $3, capacity = $4
      WHERE id = $1 AND active = false RETURNING id, delivery_point_id AS "pointId", starts_at AS "startsAt", ends_at AS "endsAt", capacity, active`,
      [id, input.startsAt, input.endsAt, input.capacity]);
    if (!result.rowCount) throw new CatalogError(409, "slot_not_editable");
    return result.rows[0];
  } catch (error) { catalogConflict(error); }
}

export async function validateCatalogPoint(pool: Pool, id: string, actorId: string, reference: string) {
  try {
    const result = await pool.query(`UPDATE delivery_points SET validation_reference = $3, validated_by = $2, validated_at = now(), active = true
      WHERE id = $1 AND active = false AND appointment_required = true RETURNING id, code, name, address, municipality, active, validation_reference AS "validationReference", validated_at AS "validatedAt"`, [id, actorId, reference]);
    if (result.rowCount) return { point: result.rows[0], replayed: false };
    const existing = await pool.query(`SELECT id, code, name, address, municipality, active, validation_reference AS "validationReference", validated_by AS "validatedBy", validated_at AS "validatedAt" FROM delivery_points WHERE id = $1`, [id]);
    if (existing.rows[0]?.active && existing.rows[0].validatedBy === actorId && existing.rows[0].validationReference === reference) return { point: existing.rows[0], replayed: true };
    throw new CatalogError(409, "point_validation_conflict");
  } catch (error) { catalogConflict(error); }
}

export async function validateCatalogSlot(pool: Pool, id: string, actorId: string, reference: string) {
  try {
    const result = await pool.query(`UPDATE delivery_slots SET validation_reference = $3, validated_by = $2, validated_at = now(), active = true
      WHERE id = $1 AND active = false RETURNING id, delivery_point_id AS "pointId", starts_at AS "startsAt", ends_at AS "endsAt", capacity, active, validation_reference AS "validationReference", validated_at AS "validatedAt"`, [id, actorId, reference]);
    if (result.rowCount) return { slot: result.rows[0], replayed: false };
    const existing = await pool.query(`SELECT id, delivery_point_id AS "pointId", starts_at AS "startsAt", ends_at AS "endsAt", capacity, active, validation_reference AS "validationReference", validated_by AS "validatedBy", validated_at AS "validatedAt" FROM delivery_slots WHERE id = $1`, [id]);
    if (existing.rows[0]?.active && existing.rows[0].validatedBy === actorId && existing.rows[0].validationReference === reference) return { slot: existing.rows[0], replayed: true };
    throw new CatalogError(409, "slot_validation_conflict");
  } catch (error) { catalogConflict(error); }
}

export async function updateActiveSlotCapacity(pool: Pool, id: string, actorId: string, capacity: unknown, reference: string) {
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) throw new CatalogError(400, "invalid_slot_capacity");
  try {
    const result = await pool.query(`UPDATE delivery_slots SET capacity = $2, validation_reference = $4, validated_by = $3, validated_at = now()
      WHERE id = $1 AND active = true RETURNING id, delivery_point_id AS "pointId", starts_at AS "startsAt", ends_at AS "endsAt", capacity, active`, [id, capacity, actorId, reference]);
    if (!result.rowCount) throw new CatalogError(409, "slot_not_active");
    return result.rows[0];
  } catch (error) { catalogConflict(error); }
}

export async function deactivateCatalogRecord(pool: Pool, kind: "points" | "slots", id: string) {
  const table = kind === "points" ? "delivery_points" : "delivery_slots";
  try {
    const result = await pool.query(`UPDATE ${table} SET active = false WHERE id = $1 AND active = true RETURNING id, active`, [id]);
    if (result.rowCount) return result.rows[0];
    const existing = await pool.query(`SELECT id, active FROM ${table} WHERE id = $1`, [id]);
    if (existing.rowCount) return existing.rows[0];
    throw new CatalogError(404, "catalog_record_not_found");
  } catch (error) { catalogConflict(error); }
}