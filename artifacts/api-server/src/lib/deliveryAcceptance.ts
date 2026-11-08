import type { Pool } from "pg";
import { canAccessVerifierQueue, uuidPattern } from "./pilotPolicy.ts";
import { DeliveryLifecycleError } from "./deliveryLifecycle.ts";

export async function hasDeliveryAcceptanceSchema(pool: Pick<Pool, "query">): Promise<boolean> {
  const result = await pool.query("SELECT to_regclass('public.delivery_request_acceptances') IS NOT NULL AS ready");
  return result.rows[0]?.ready === true;
}

// Accept a digital request for administrative coordination only.
// No delivery status is changed and no physical reception or EcoPuntos is recorded.
export async function acceptDeliveryRequest(pool: Pool, actorId: string, role: unknown, deliveryId: string) {
  if (!actorId || !uuidPattern.test(deliveryId)) throw new DeliveryLifecycleError(400, "invalid_delivery");
  if (!canAccessVerifierQueue(role)) throw new DeliveryLifecycleError(403, "verifier_required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query<{ role: string }>(
      "SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE", [actorId]);
    if (!canAccessVerifierQueue(actor.rows[0]?.role)) throw new DeliveryLifecycleError(403, "verifier_required");

    const record = await client.query<{ user_id: string; status: string; request_version: number }>(
      "SELECT user_id, status, request_version FROM deliveries WHERE id=$1 FOR UPDATE", [deliveryId]);
    const delivery = record.rows[0];
    if (!delivery) throw new DeliveryLifecycleError(404, "delivery_not_found");
    // Accepting a digital coordination request is an administrative acknowledgement,
    // NOT physical reception or verification. The sole administrator may acknowledge
    // their own request, but existing physical self-verification restrictions remain.
    // Never credit points from this operation.
    if (delivery.request_version !== 2) throw new DeliveryLifecycleError(409, "delivery_details_required");

    const prior = await client.query<{ accepted_by: string; accepted_at: Date }>(
      "SELECT accepted_by, accepted_at FROM delivery_request_acceptances WHERE delivery_id=$1", [deliveryId]);
    if (prior.rows[0]) {
      await client.query("COMMIT");
      return { deliveryId, acceptedAt: prior.rows[0].accepted_at, replayed: true };
    }
    if (delivery.status !== "pending" && delivery.status !== "scheduled") {
      throw new DeliveryLifecycleError(409, "delivery_not_pending");
    }
    const insert = await client.query<{ accepted_at: Date }>(
      "INSERT INTO delivery_request_acceptances(delivery_id, accepted_by) VALUES($1,$2) RETURNING accepted_at",
      [deliveryId, actorId]);
    await client.query("COMMIT");
    return { deliveryId, acceptedAt: insert.rows[0].accepted_at, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof DeliveryLifecycleError) throw error;
    if ((error as { code?: string }).code === "42501") throw new DeliveryLifecycleError(503, "delivery_permissions_unavailable");
    throw error;
  } finally {
    client.release();
  }
}
