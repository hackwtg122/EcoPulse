import { hasDeliveryDetailsSchema } from "./deliveryDetails";
import { getEvalPool } from "./evalConnection";

export type EvalSlot = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  remainingCapacity: number;
};

export type EvalPoint = {
  id: string;
  code: string;
  name: string;
  address: string;
  municipality: string;
  timeZone: string;
  appointmentRequired: boolean;
  slots: EvalSlot[];
};

export async function loadEvaluationCatalog(): Promise<{ points: EvalPoint[] }> {
  const pool = await getEvalPool();
  const schemaReady = await hasDeliveryDetailsSchema(pool);
  if (!schemaReady) return { points: [] };

  const [pointsRes, slotsRes] = await Promise.all([
    pool.query<{
      id: string;
      code: string;
      name: string;
      address: string;
      municipality: string;
      time_zone: string;
      appointment_required: boolean;
    }>(
      `SELECT id, code, name, address, municipality, time_zone, appointment_required
       FROM delivery_points
       WHERE active = true AND code LIKE 'eval-%'
       ORDER BY name, id`
    ),
    pool.query<{
      id: string;
      delivery_point_id: string;
      starts_at: Date;
      ends_at: Date;
      remaining_capacity: number;
    }>(
      `SELECT s.id, s.delivery_point_id, s.starts_at, s.ends_at,
              (s.capacity - count(d.id))::integer AS remaining_capacity
       FROM delivery_slots s
       LEFT JOIN deliveries d ON d.slot_id = s.id AND d.status NOT IN ('cancelled','rejected')
       WHERE s.active = true AND s.starts_at > now() AND EXISTS (
         SELECT 1 FROM delivery_points p WHERE p.id = s.delivery_point_id AND p.code LIKE 'eval-%'
       )
       GROUP BY s.id
       HAVING s.capacity - count(d.id) > 0
       ORDER BY s.starts_at, s.id`
    ),
  ]);

  const byPoint = new Map<string, EvalSlot[]>();
  for (const r of slotsRes.rows) {
    const list = byPoint.get(r.delivery_point_id) ?? [];
    list.push({
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      remainingCapacity: r.remaining_capacity,
    });
    byPoint.set(r.delivery_point_id, list);
  }

  const points: EvalPoint[] = pointsRes.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    address: r.address,
    municipality: r.municipality,
    timeZone: r.time_zone,
    appointmentRequired: r.appointment_required,
    slots: byPoint.get(r.id) ?? [],
  }));

  return { points };
}
