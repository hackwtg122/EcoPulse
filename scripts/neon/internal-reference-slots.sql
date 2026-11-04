-- Internal reference slots only. No validator or evidence is fabricated, and
-- the existing operational validation gates remain closed for these records.
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
WITH windows AS (
  SELECT p.id AS point_id,
    (date_trunc('week', now() AT TIME ZONE 'America/Bogota')
      + w.week_offset * interval '7 days' + interval '9 hours') AT TIME ZONE 'America/Bogota' AS starts_at
  FROM delivery_points p CROSS JOIN (VALUES (2), (3)) AS w(week_offset)
  WHERE p.code ~ '^eval-0[1-8]$'
    AND p.validation_reference = 'academic:ecopulse/centro-' || right(p.code, 2)
)
INSERT INTO delivery_slots (id, delivery_point_id, starts_at, ends_at, capacity, active)
SELECT gen_random_uuid(), w.point_id, w.starts_at, w.starts_at + interval '2 hours', 20, false
FROM windows w
WHERE NOT EXISTS (
  SELECT 1 FROM delivery_slots s
  WHERE s.delivery_point_id = w.point_id
    AND s.starts_at < w.starts_at + interval '2 hours' AND s.ends_at > w.starts_at
)
ON CONFLICT (delivery_point_id, starts_at, ends_at) DO NOTHING;
COMMIT;
