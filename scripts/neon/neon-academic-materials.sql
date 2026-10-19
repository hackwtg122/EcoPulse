-- SOLO neondb, DESPUÉS de las migraciones Drizzle 0000-0003; no ejecutar sin autorización.
-- Ejecutar con psql -X -v ON_ERROR_STOP=1. Reejecutable (IF NOT EXISTS).
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Academic materials require neondb';
  END IF;
  IF to_regclass('public.delivery_points') IS NULL
    OR to_regclass('public.material_categories') IS NULL THEN
    RAISE EXCEPTION 'Missing base schema: run Drizzle 0000-0003 first';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.delivery_point_materials (
  delivery_point_id uuid NOT NULL REFERENCES public.delivery_points(id) ON DELETE RESTRICT,
  category_code text NOT NULL REFERENCES public.material_categories(code) ON DELETE RESTRICT,
  PRIMARY KEY (delivery_point_id, category_code)
);
CREATE INDEX IF NOT EXISTS delivery_point_materials_category_idx
  ON public.delivery_point_materials (category_code, delivery_point_id);
COMMIT;
