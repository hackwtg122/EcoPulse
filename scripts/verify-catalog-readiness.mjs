import { fileURLToPath } from "node:url";
import pg from "pg";
process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || url.port !== "5432" || url.pathname !== "/ecopulse_dev" || decodeURIComponent(url.username) !== "ecopulse_app") throw new Error("Refusing to inspect any database other than local ecopulse_dev with ecopulse_app");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(`SELECT current_database() AS database, current_user AS role,
    (SELECT count(*)::integer FROM delivery_points WHERE active) AS active_points,
    (SELECT count(*)::integer FROM delivery_points WHERE NOT active) AS draft_points,
    (SELECT count(*)::integer FROM delivery_slots WHERE active) AS active_slots,
    (SELECT count(*)::integer FROM delivery_slots WHERE NOT active) AS draft_slots,
    has_column_privilege(current_user, 'public.delivery_points', 'code', 'INSERT') AS can_insert_point_code,
    has_column_privilege(current_user, 'public.delivery_slots', 'capacity', 'INSERT') AS can_insert_slot_capacity,
    has_column_privilege(current_user, 'public.delivery_points', 'active', 'INSERT') AS can_insert_point_active,
    has_column_privilege(current_user, 'public.delivery_slots', 'active', 'INSERT') AS can_insert_slot_active,
    has_column_privilege(current_user, 'public.delivery_points', 'active', 'UPDATE') AS can_update_point_active,
    has_column_privilege(current_user, 'public.delivery_slots', 'active', 'UPDATE') AS can_update_slot_active,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_points' AND column_name = 'validated_at') AS catalog_validation_applied`);
  console.log(JSON.stringify({ ...result.rows[0], flags: { catalogAdmin: process.env.PILOT_CATALOG_ADMIN_ENABLED === "true", catalogPublication: process.env.PILOT_CATALOG_PUBLICATION_ENABLED === "true", deliveryDetails: process.env.PILOT_DELIVERY_DETAILS_ENABLED === "true", verification: process.env.PILOT_VERIFICATION_ENABLED === "true", rewards: process.env.PILOT_REWARDS_ENABLED === "true" } }, null, 2));
} finally { await pool.end(); }