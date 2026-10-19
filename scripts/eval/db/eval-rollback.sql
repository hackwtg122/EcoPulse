-- Rollback operativo reversible: detiene NUEVAS operaciones, conserva historiales y datos.
-- Solo ecopulse_eval, psql -X -v ON_ERROR_STOP=1; no DROP/DELETE.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'ecopulse_eval' THEN RAISE EXCEPTION 'Wrong database'; END IF;
  IF EXISTS (SELECT 1 FROM deliveries d JOIN delivery_points p ON p.id=d.delivery_point_id
      WHERE p.code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
        AND d.status NOT IN ('cancelled','rejected','approved')) THEN
    RAISE EXCEPTION 'Outstanding academic reservations: rollback deferred; no records changed';
  END IF;
  IF EXISTS (SELECT 1 FROM redemptions r WHERE r.reward_id IN (
      'e1f00201-0001-4000-8000-000000000001'::uuid,
      'e1f00201-0002-4000-8000-000000000002'::uuid,
      'e1f00201-0003-4000-8000-000000000003'::uuid)
      AND r.fulfillment_status = 'reserved') THEN
    RAISE EXCEPTION 'Outstanding academic redemptions: rollback deferred; no records changed';
  END IF;
END $$;
UPDATE delivery_slots SET active=false WHERE active=true AND delivery_point_id IN
  (SELECT id FROM delivery_points WHERE code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08'));
UPDATE delivery_points SET active=false WHERE active=true AND code IN
  ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08');
UPDATE rewards SET active=false WHERE active=true AND id IN (
  'e1f00201-0001-4000-8000-000000000001'::uuid,
  'e1f00201-0002-4000-8000-000000000002'::uuid,
  'e1f00201-0003-4000-8000-000000000003'::uuid);
COMMIT;
