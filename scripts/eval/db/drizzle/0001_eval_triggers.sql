-- Verificación posterior a 0000_eval_init.sql; no recrear triggers Drizzle.
DO $$ BEGIN
  IF current_database() <> 'ecopulse_eval' THEN RAISE EXCEPTION 'Wrong database'; END IF;
  IF to_regclass('public.delivery_points') IS NULL OR to_regclass('public.delivery_slots') IS NULL
    OR to_regclass('public.delivery_items') IS NULL OR to_regclass('public.point_movements') IS NULL
    OR to_regclass('public.redemptions') IS NULL THEN
    RAISE EXCEPTION 'Incomplete 0000-0003 migration chain';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.deliveries'::regclass AND tgname = 'deliveries_destination_guard' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.delivery_points'::regclass AND tgname = 'delivery_points_validation_guard' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rewards'::regclass AND tgname = 'rewards_protect_published_details' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Required delivery, catalog or reward triggers missing';
  END IF;
END $$;
