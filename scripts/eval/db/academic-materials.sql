-- ONLY ecopulse_eval, AFTER canonical Drizzle 0000-0003; do not execute without approval.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'ecopulse_eval' OR to_regclass('public.delivery_points') IS NULL
    OR to_regclass('public.material_categories') IS NULL THEN
    RAISE EXCEPTION 'Academic material catalog requires migrated ecopulse_eval';
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
