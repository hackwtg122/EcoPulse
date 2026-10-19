-- SOLO ecopulse_eval, ejecutar con psql -X -v ON_ERROR_STOP=1 como dueño del esquema.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'ecopulse_eval' OR to_regclass('public.delivery_items') IS NULL
    OR to_regclass('public.delivery_point_materials') IS NULL
    OR to_regclass('public.favorite_centers') IS NULL
    OR to_regclass('public.redemptions') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecopulse_app') THEN
    RAISE EXCEPTION 'Wrong database, incomplete migration or missing app role';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ecopulse_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ecopulse_app;
GRANT SELECT ON users, scans, deliveries, material_categories, delivery_points,
  delivery_slots, delivery_point_materials, favorite_centers, delivery_items, delivery_status_events, delivery_idempotency,
  verifications, point_movements, rewards, redemptions TO ecopulse_app;
GRANT INSERT ON users, scans, deliveries, delivery_items, delivery_status_events,
  delivery_idempotency, verifications, point_movements, redemptions TO ecopulse_app;
-- Acciones administrativas restringidas además por Clerk + rol admin en Express.
GRANT INSERT ON delivery_points, delivery_slots, rewards TO ecopulse_app;
GRANT INSERT, DELETE ON favorite_centers TO ecopulse_app;
GRANT UPDATE (status) ON deliveries TO ecopulse_app;
GRANT UPDATE (delivery_id, completed_at) ON delivery_idempotency TO ecopulse_app;
GRANT UPDATE (name, address, municipality, time_zone, appointment_required,
  active, validation_reference, validated_by, validated_at, updated_at) ON delivery_points TO ecopulse_app;
GRANT UPDATE (starts_at, ends_at, capacity, active, validation_reference,
  validated_by, validated_at) ON delivery_slots TO ecopulse_app;
GRANT UPDATE (title, description, cost, active, inventory_remaining,
  fulfillment_reference, validated_by, validated_at, updated_at) ON rewards TO ecopulse_app;
GRANT UPDATE (fulfillment_status, fulfillment_reference, fulfilled_by, fulfilled_at)
  ON redemptions TO ecopulse_app;
-- Sin DELETE, sin GRANT globales ni privilegios futuros automáticos.
COMMIT;
