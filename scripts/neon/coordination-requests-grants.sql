-- Grants for the coordination request tables. Apply only on neondb after the
-- additive migration and only to the restricted ecopulse_app role.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Grants require neondb';
  END IF;
  IF to_regclass('public.coordination_requests') IS NULL
    OR to_regclass('public.coordination_request_items') IS NULL
    OR to_regclass('public.coordination_request_events') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecopulse_app') THEN
    RAISE EXCEPTION 'Coordination migration or app role missing';
  END IF;
END $$;

GRANT SELECT ON public.coordination_requests, public.coordination_request_items, public.coordination_request_events TO ecopulse_app;
GRANT INSERT ON public.coordination_requests, public.coordination_request_items, public.coordination_request_events TO ecopulse_app;
-- Assignment only transitions the request and links the created delivery.
GRANT UPDATE (status, delivery_id, assigned_point_id, assigned_by, assigned_at, updated_at)
  ON public.coordination_requests TO ecopulse_app;
COMMIT;
