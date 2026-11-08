import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { canAccessVerifierQueue, uuidPattern } from "./pilotPolicy.ts";
import { DeliveryLifecycleError } from "./deliveryLifecycle.ts";
import { isCatalogPublicationReference } from "./deliveryCatalog.ts";

type HandoffDetails = { pointId: string; handoffAt: string; note: string | null };

export async function hasCoordinationPlansSchema(pool: Pick<Pool, "query">): Promise<boolean> {
  const result = await pool.query("SELECT to_regclass('public.delivery_coordination_plans') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}

export function parseHandoffDetails(body: unknown): HandoffDetails {
  if (typeof body !== "object" || body == null || Array.isArray(body)) throw new DeliveryLifecycleError(400, "invalid_handoff");
  const x = body as Record<string, unknown>;
  if (Object.keys(x).some(key => !["pointId", "handoffAt", "note"].includes(key))) {
    throw new DeliveryLifecycleError(400, "unexpected_fields");
  }
  if (typeof x.pointId !== "string" || !uuidPattern.test(x.pointId)) {
    throw new DeliveryLifecycleError(400, "invalid_handoff_point");
  }
  if (typeof x.handoffAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x.handoffAt)) {
    throw new DeliveryLifecycleError(400, "invalid_handoff_date");
  }
  const ts = Date.parse(x.handoffAt);
  if (!Number.isFinite(ts) || ts < Date.now() + 5 * 60_000 || ts > Date.now() + 180 * 24 * 60 * 60_000) {
    throw new DeliveryLifecycleError(400, "invalid_handoff_date");
  }
  if (x.note != null && (typeof x.note !== "string" || x.note.trim().length < 1 || x.note.trim().length > 500)) {
    throw new DeliveryLifecycleError(400, "invalid_handoff_note");
  }
  return {
    pointId: x.pointId,
    handoffAt: new Date(ts).toISOString(),
    note: x.note == null ? null : x.note.trim() as string,
  };
}

export async function planDeliveryHandoff(pool: Pool, actorId: string, role: unknown, deliveryId: string, data: HandoffDetails) {
  if (!canAccessVerifierQueue(role)) throw new DeliveryLifecycleError(403, "verifier_required");
  if (!actorId || !uuidPattern.test(deliveryId)) throw new DeliveryLifecycleError(400, "invalid_delivery");
  const payload = parseHandoffDetails(data);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query<{ role: string }>(
      "SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE", [actorId]);
    if (!canAccessVerifierQueue(actor.rows[0]?.role)) throw new DeliveryLifecycleError(403, "verifier_required");
    const request = await client.query<{ status: string; request_version: number; accepted_at: Date | null }>(`
      SELECT d.status, d.request_version, a.accepted_at
      FROM deliveries d LEFT JOIN delivery_request_acceptances a ON a.delivery_id = d.id
      WHERE d.id=$1 FOR UPDATE OF d`, [deliveryId]);
    const d = request.rows[0];
    if (!d) throw new DeliveryLifecycleError(404, "delivery_not_found");
    if (d.request_version !== 2 || !d.accepted_at) throw new DeliveryLifecycleError(409, "delivery_not_accepted");
    if (!["pending", "scheduled"].includes(d.status)) throw new DeliveryLifecycleError(409, "delivery_not_pending");
    // Resolve the configured location server-side. No user-provided street name can
    // be substituted for a published center; material compatibility is mandatory.
    const pointResult = await client.query<{
      address: string; validation_reference: string | null; validated_by: string | null; validated_at: Date | null;
    }>(`SELECT address, validation_reference, validated_by, validated_at
         FROM delivery_points WHERE id=$1 AND active=true FOR SHARE`, [payload.pointId]);
    const point = pointResult.rows[0];
    if (!point || !point.validated_by || !point.validated_at ||
        !isCatalogPublicationReference(point.validation_reference)) {
      throw new DeliveryLifecycleError(409, "handoff_point_unavailable");
    }
    const configuredAddress = point.address.trim();
    if (configuredAddress.length < 8 || configuredAddress.length > 200) {
      throw new DeliveryLifecycleError(409, "handoff_point_address_unavailable");
    }
    const materialCheck = await client.query<{total: number; unsupported: number}>(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE pm.category_code IS NULL)::int AS unsupported
      FROM delivery_items di
      LEFT JOIN delivery_point_materials pm
        ON pm.delivery_point_id=$2 AND pm.category_code=di.category_code
      WHERE di.delivery_id=$1`, [deliveryId,payload.pointId]);
    if (!materialCheck.rows[0] || materialCheck.rows[0].total < 1 || materialCheck.rows[0].unsupported > 0) {
      throw new DeliveryLifecycleError(409, "handoff_materials_unavailable");
    }
    const hash = createHash("sha256").update(JSON.stringify({ ...payload, handoffAddress: configuredAddress })).digest("hex");
    const prev = await client.query<{ plan_hash: string; handoff_address: string; handoff_at: Date; note: string | null; created_at: Date }>(`
      SELECT plan_hash, handoff_address, handoff_at, note, created_at
      FROM delivery_coordination_plans WHERE delivery_id=$1
      ORDER BY created_at DESC, id DESC LIMIT 1`, [deliveryId]);
    if (prev.rows[0]?.plan_hash === hash) {
      await client.query("COMMIT");
      const p = prev.rows[0];
      return { deliveryId, plan: { handoffAddress:p.handoff_address, handoffAt:p.handoff_at, note:p.note, plannedAt:p.created_at }, replayed:true };
    }
    // The platform records a proposal, not a physical reception. Superseded plans
    // remain append-only for audit and the latest plan is what the participant sees.
    const created = await client.query<{ handoff_address:string; handoff_at:Date; note:string|null; created_at:Date }>(`
      INSERT INTO delivery_coordination_plans
      (id,delivery_id,planned_by,handoff_address,handoff_at,note,plan_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING handoff_address,handoff_at,note,created_at`,
      [randomUUID(),deliveryId,actorId,configuredAddress,payload.handoffAt,payload.note,hash]);
    await client.query("COMMIT");
    const p=created.rows[0];
    return { deliveryId, plan:{ handoffAddress:p.handoff_address, handoffAt:p.handoff_at, note:p.note, plannedAt:p.created_at }, replayed:false };
  } catch(error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof DeliveryLifecycleError) throw error;
    if ((error as {code?:string}).code==="42501") throw new DeliveryLifecycleError(503,"delivery_permissions_unavailable");
    throw error;
  } finally { client.release(); }
}
