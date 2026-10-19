-- SOLO neondb, DESPUÉS de las migraciones Drizzle 0000-0003; preparado, no aplicado.
-- Ejecutar con psql -X -v ON_ERROR_STOP=1. Reejecutable (IF NOT EXISTS).
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Academic favorites require neondb';
  END IF;
  IF to_regclass('public.users') IS NULL
    OR to_regclass('public.delivery_points') IS NULL THEN
    RAISE EXCEPTION 'Wrong database or missing base schema';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.favorite_centers (
  user_id text NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE RESTRICT,
  delivery_point_id uuid NOT NULL REFERENCES public.delivery_points(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, delivery_point_id)
);
COMMIT;
