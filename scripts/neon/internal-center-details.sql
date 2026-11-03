-- Fill missing reference coordinates on the eight pre-existing internal records.
-- This does not make them operational or create physical delivery claims.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF current_database() <> 'neondb' OR (
    SELECT count(*) FROM delivery_points
    WHERE code ~ '^eval-0[1-8]$'
      AND validation_reference = 'academic:ecopulse/centro-' || right(code, 2)
  ) <> 8 THEN
    RAISE EXCEPTION 'internal reference catalog mismatch';
  END IF;
END $$;
UPDATE delivery_points p SET latitude = v.latitude, longitude = v.longitude
FROM (VALUES
  ('eval-01', 8.7452::float8, -75.8705::float8),
  ('eval-02', 8.7521::float8, -75.8823::float8),
  ('eval-03', 8.7675::float8, -75.8691::float8),
  ('eval-04', 8.7748::float8, -75.8904::float8),
  ('eval-05', 8.7583::float8, -75.8972::float8),
  ('eval-06', 8.7406::float8, -75.8937::float8),
  ('eval-07', 8.7289::float8, -75.8861::float8),
  ('eval-08', 8.7194::float8, -75.8768::float8)
) AS v(code, latitude, longitude)
WHERE p.code = v.code
  AND p.validation_reference = 'academic:ecopulse/centro-' || right(p.code, 2)
  AND p.latitude IS NULL AND p.longitude IS NULL;
INSERT INTO delivery_point_materials (delivery_point_id, category_code)
SELECT id, 'plastic' FROM delivery_points
WHERE code = 'eval-05' AND validation_reference = 'academic:ecopulse/centro-05'
  AND (SELECT count(*) FROM delivery_point_materials WHERE delivery_point_id = delivery_points.id) < 2
ON CONFLICT (delivery_point_id, category_code) DO NOTHING;
COMMIT;
