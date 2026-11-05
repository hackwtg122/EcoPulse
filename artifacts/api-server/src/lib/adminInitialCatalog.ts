import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// An empty catalog is prepared once, from a real admin session. Existing
// records are never modified and none of the templates is publicly bookable.
export async function initializeAdminCatalog(pool: Pool, actorId: string, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", ["ecopulse:admin-initial-catalog:v1"]);
    const actor = await client.query<{ role: string }>(
      "SELECT role FROM users WHERE clerk_user_id=$1 FOR SHARE", [actorId],
    );
    if (actor.rows[0]?.role !== "admin") {
      const error = new Error("admin_required");
      Object.assign(error, { status: 403, code: "admin_required" });
      throw error;
    }

    const centerRows = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM delivery_points");
    const rewardRows = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM rewards");
    let centersCreated = 0;
    let slotsCreated = 0;
    let rewardsCreated = 0;

    if (Number(centerRows.rows[0]?.count ?? 0) === 0) {
      const centers = [
        { code: "ecopulse-centro-01", name: "Centro EcoPulse 01", materials: ["paper", "plastic", "metal"] },
        { code: "ecopulse-centro-02", name: "Centro EcoPulse 02", materials: ["paper", "glass", "organic"] },
      ];
      const first = new Date(now.valueOf() + 8 * 86400000);
      first.setUTCHours(14, 0, 0, 0);
      const windows = [0, 1].map((index) => {
        const start = new Date(first.valueOf() + index * 4 * 3600000);
        return [start.toISOString(), new Date(start.valueOf() + 2 * 3600000).toISOString()];
      });
      for (const [index, center] of centers.entries()) {
        const id = randomUUID();
        const result = await client.query<{ id: string }>(`INSERT INTO delivery_points
          (id,code,name,address,municipality,time_zone,appointment_required,active)
          VALUES ($1,$2,$3,$4,$5,$6,true,false) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [id, center.code, center.name, "Dirección por configurar", "Montería", "America/Bogota"]);
        if (!result.rows[0]) continue;
        centersCreated++;
        for (const material of center.materials) {
          await client.query(
            "INSERT INTO delivery_point_materials (delivery_point_id,category_code) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [id, material],
          );
        }
        // Match the catalog service's advisory lock to avoid overlapping slots.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [id]);
        const [startsAt, endsAt] = windows[index];
        await client.query(`INSERT INTO delivery_slots
          (id,delivery_point_id,starts_at,ends_at,capacity,active)
          VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,false)
          ON CONFLICT (delivery_point_id,starts_at,ends_at) DO NOTHING`,
          [randomUUID(), id, startsAt, endsAt, 10]);
        slotsCreated++;
      }
    }

    if (Number(rewardRows.rows[0]?.count ?? 0) === 0) {
      const rewards = [
        ["Insignia Huella Verde", "Insignia digital coleccionable para celebrar tu compromiso con el reciclaje.", 20],
        ["Fondo virtual de naturaleza", "Ilustración de naturaleza para personalizar tus dispositivos.", 40],
        ["Kit digital de reciclaje", "Guía descargable de separación y aprovechamiento de residuos.", 60],
      ] as const;
      for (const [title, description, cost] of rewards) {
        const inserted = await client.query(`INSERT INTO rewards
          (id,title,description,cost,active) VALUES ($1,$2,$3,$4,false) RETURNING id`,
          [randomUUID(), title, description, cost]);
        if (inserted.rows.length) rewardsCreated++;
      }
    }

    await client.query("COMMIT");
    return { centersCreated, slotsCreated, rewardsCreated, published: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
