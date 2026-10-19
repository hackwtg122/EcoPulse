import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canAccessVerifierQueue, canVerifyDelivery, pointsForVerifiedGrams, uuidPattern, validReceiptCode, validRejectionReason, type RejectionReasonCode } from "./pilotPolicy.ts";

type Decision = "approved" | "rejected";
type DeliveryRow = { id: string; user_id: string; status: string };
type VerificationRow = { id: string; verifier_id: string; decision: Decision; verified_grams: number | null; receipt_code: string | null };

export class DeliveryLifecycleError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function lockedDelivery(client: PoolClient, deliveryId: string): Promise<DeliveryRow> {
  const result = await client.query<DeliveryRow>(
    "SELECT id, user_id, status FROM deliveries WHERE id = $1 FOR UPDATE", [deliveryId],
  );
  const delivery = result.rows[0];
  if (!delivery) throw new DeliveryLifecycleError(404, "delivery_not_found");
  return delivery;
}

function requireVerifier(role: unknown, actorId: string, deliveryId: string) {
  if (!canAccessVerifierQueue(role)) throw new DeliveryLifecycleError(403, "verifier_required");
  if (!actorId || !uuidPattern.test(deliveryId)) throw new DeliveryLifecycleError(400, "invalid_delivery");
}

async function inTransaction<T>(pool: Pool, task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof DeliveryLifecycleError) throw error;
    const code = (error as { code?: string }).code;
    if (code === "23505" || code === "23514" || code === "23503") {
      throw new DeliveryLifecycleError(409, "delivery_state_conflict");
    }
    if (code === "42501") throw new DeliveryLifecycleError(503, "delivery_permissions_unavailable");
    throw error;
  } finally {
    client.release();
  }
}

export async function receivePhysicalDelivery(
  pool: Pool, actorId: string, role: unknown, deliveryId: string,
): Promise<{ deliveryId: string; status: "received"; replayed: boolean }> {
  requireVerifier(role, actorId, deliveryId);
  return inTransaction(pool, async (client) => {
    const delivery = await lockedDelivery(client, deliveryId);
    if (!canVerifyDelivery(role, actorId, delivery.user_id)) {
      throw new DeliveryLifecycleError(403, "self_verification_forbidden");
    }
    if (delivery.status === "received") {
      const prior = await client.query<{ actor_user_id: string }>(`
        SELECT actor_user_id FROM delivery_status_events
        WHERE delivery_id = $1 AND to_status = 'received'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `, [deliveryId]);
      if (prior.rows[0]?.actor_user_id !== actorId) {
        throw new DeliveryLifecycleError(409, "already_received");
      }
      return { deliveryId, status: "received", replayed: true };
    }
    if (delivery.status !== "pending" && delivery.status !== "scheduled") {
      throw new DeliveryLifecycleError(409, "delivery_not_receivable");
    }
    await client.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status, reason_code)
      VALUES ($1, $2, $3, $4, 'received', $5)
    `, [randomUUID(), deliveryId, actorId, delivery.status,
      process.env.EVALUATION_MODE_ENABLED === "true" ? "academic_receipt" : null]);
    await client.query("UPDATE deliveries SET status = 'received' WHERE id = $1", [deliveryId]);
    return { deliveryId, status: "received", replayed: false };
  });
}

export async function verifyPhysicalDelivery(
  pool: Pool, actorId: string, role: unknown, deliveryId: string,
  decision: Decision, verifiedGrams: number | null, receiptCode: string | null, pointsPerKg: number | null,
  reasonCode: RejectionReasonCode | null = null, maxPointsPerDelivery: number | null = null,
): Promise<{ deliveryId: string; decision: Decision; verifiedGrams: number | null; points: number; replayed: boolean }> {
  requireVerifier(role, actorId, deliveryId);
  if (decision !== "approved" && decision !== "rejected") throw new DeliveryLifecycleError(400, "invalid_verification");
  if (decision === "approved") {
    if (verifiedGrams === null || !validReceiptCode(receiptCode) || pointsPerKg === null) {
      throw new DeliveryLifecycleError(400, "incomplete_verification");
    }
    if (reasonCode !== null) throw new DeliveryLifecycleError(400, "rejection_reason_not_allowed");
    pointsForVerifiedGrams(verifiedGrams, pointsPerKg);
    if (maxPointsPerDelivery !== null && (!Number.isSafeInteger(maxPointsPerDelivery) || maxPointsPerDelivery < 1 || maxPointsPerDelivery > 100_000)) {
      throw new DeliveryLifecycleError(400, "invalid_points_cap");
    }
  } else if (verifiedGrams !== null || receiptCode !== null || !validRejectionReason(reasonCode)) {
    throw new DeliveryLifecycleError(400, "rejection_reason_required");
  }
  return inTransaction(pool, async (client) => {
    const delivery = await lockedDelivery(client, deliveryId);
    if (!canVerifyDelivery(role, actorId, delivery.user_id)) {
      throw new DeliveryLifecycleError(403, "self_verification_forbidden");
    }
    if (delivery.status === "approved" || delivery.status === "rejected") {
      const prior = await client.query<VerificationRow>(`
        SELECT id, verifier_id, decision, verified_grams, receipt_code
        FROM verifications WHERE delivery_id = $1
      `, [deliveryId]);
      const row = prior.rows[0];
      const priorReason = decision === "rejected" ? await client.query<{ reason_code: string | null }>(`
        SELECT reason_code FROM delivery_status_events
        WHERE delivery_id = $1 AND to_status = 'rejected'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `, [deliveryId]) : null;
      if (!row || row.verifier_id !== actorId || row.decision !== decision ||
          row.verified_grams !== verifiedGrams || row.receipt_code !== receiptCode ||
          (decision === "rejected" && priorReason?.rows[0]?.reason_code !== reasonCode)) {
        throw new DeliveryLifecycleError(409, "already_verified");
      }
      const movement = await client.query<{ points: string }>(`
        SELECT coalesce(sum(delta), 0)::text AS points
        FROM point_movements WHERE kind = 'delivery' AND source_id = $1
      `, [row.id]);
      return { deliveryId, decision, verifiedGrams, points: Number(movement.rows[0].points), replayed: true };
    }
    if (delivery.status !== "received") throw new DeliveryLifecycleError(409, "receipt_required");
    const verificationId = randomUUID();
    await client.query(`
      INSERT INTO verifications (id, delivery_id, verifier_id, decision, verified_grams, receipt_code)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [verificationId, deliveryId, actorId, decision, verifiedGrams, receiptCode]);
    const auditCode = decision === "approved"
      ? `${process.env.EVALUATION_MODE_ENABLED === "true" ? "academic_" : ""}points_rate_${pointsPerKg}_cap_${maxPointsPerDelivery ?? "none"}`
      : reasonCode;
    await client.query(`
      INSERT INTO delivery_status_events (id, delivery_id, actor_user_id, from_status, to_status, reason_code)
      VALUES ($1, $2, $3, 'received', $4, $5)
    `, [randomUUID(), deliveryId, actorId, decision, auditCode]);
    await client.query("UPDATE deliveries SET status = $2 WHERE id = $1", [deliveryId, decision]);
    const computedPoints = decision === "approved" ? pointsForVerifiedGrams(verifiedGrams!, pointsPerKg!) : 0;
    const points = maxPointsPerDelivery === null ? computedPoints : Math.min(computedPoints, maxPointsPerDelivery);
    if (points > 0) {
      await client.query(`
        INSERT INTO point_movements (id, user_id, delta, kind, source_id)
        VALUES ($1, $2, $3, 'delivery', $4)
      `, [randomUUID(), delivery.user_id, points, verificationId]);
    }
    return { deliveryId, decision, verifiedGrams, points, replayed: false };
  });
}
