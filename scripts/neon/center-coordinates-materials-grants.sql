-- Staged separately from the schema change. Execute only after a verified
-- restorable backup, review of the target role, and explicit authorization.
-- Grants are scoped to the columns and table required by catalog management.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'neondb' OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecopulse_app') THEN
    RAISE EXCEPTION 'Expected neondb and existing ecopulse_app role';
  END IF;
  IF to_regclass('public.delivery_point_materials') IS NULL OR
     (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_points' AND column_name IN ('latitude', 'longitude')) <> 2 THEN
    RAISE EXCEPTION 'Apply and verify the catalog schema change first';
  END IF;
END $$;
GRANT UPDATE (latitude, longitude) ON public.delivery_points TO ecopulse_app;
GRANT SELECT, INSERT, DELETE ON public.delivery_point_materials TO ecopulse_app;
COMMIT;
