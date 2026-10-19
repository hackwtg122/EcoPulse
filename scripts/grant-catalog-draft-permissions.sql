-- Prepared only. Requires explicit permission-change authorization before execution.
-- Connect as ecopulse_migrator to local ecopulse_dev; never use this role in the app.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'ecopulse_dev' OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR current_user <> 'ecopulse_migrator' THEN
    RAISE EXCEPTION 'Refusing catalog grant outside local development migrator context';
  END IF;
  IF to_regclass('public.delivery_points') IS NULL OR to_regclass('public.delivery_slots') IS NULL THEN
    RAISE EXCEPTION '0001_delivery_details tables are required';
  END IF;
END;
$$;
-- active is deliberately excluded: new rows can only use the database default false.
GRANT INSERT (id, code, name, address, municipality, time_zone, appointment_required)
ON TABLE public.delivery_points TO ecopulse_app;
GRANT INSERT (id, delivery_point_id, starts_at, ends_at, capacity)
ON TABLE public.delivery_slots TO ecopulse_app;
COMMIT;