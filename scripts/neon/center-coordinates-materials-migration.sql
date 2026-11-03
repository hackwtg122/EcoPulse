-- Staged change: do not run automatically. Requires a verified restorable
-- backup, review of the existing Drizzle journal, and explicit authorization.
-- This script does not publish records or assign coordinates or materials.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'This migration requires neondb';
  END IF;
  IF to_regclass('public.delivery_points') IS NULL OR to_regclass('public.material_categories') IS NULL THEN
    RAISE EXCEPTION 'Required catalog tables are missing';
  END IF;
END $$;

ALTER TABLE public.delivery_points ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.delivery_points ADD COLUMN IF NOT EXISTS longitude double precision;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.delivery_points'::regclass AND conname = 'delivery_points_coordinates_check') THEN
    ALTER TABLE public.delivery_points ADD CONSTRAINT delivery_points_coordinates_check CHECK (
      (latitude IS NULL AND longitude IS NULL) OR
      (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    );
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
