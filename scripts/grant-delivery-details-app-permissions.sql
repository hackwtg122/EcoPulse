-- Prepared for the controlled rollout after 0001_delivery_details is applied.
-- Do not execute before explicit authorization.
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.delivery_items') IS NULL
    OR to_regclass('public.delivery_points') IS NULL
    OR to_regclass('public.delivery_slots') IS NULL
    OR to_regclass('public.delivery_status_events') IS NULL
    OR to_regclass('public.delivery_idempotency') IS NULL THEN
    RAISE EXCEPTION '0001_delivery_details is not fully applied';
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE
  material_categories,
  delivery_points,
  delivery_slots,
  delivery_items,
  delivery_status_events,
  delivery_idempotency
FROM ecopulse_app;

GRANT SELECT ON TABLE
  material_categories,
  delivery_points,
  delivery_slots
TO ecopulse_app;

GRANT SELECT, INSERT ON TABLE
  delivery_items,
  delivery_status_events,
  delivery_idempotency
TO ecopulse_app;

GRANT UPDATE (delivery_id, completed_at)
ON TABLE delivery_idempotency
TO ecopulse_app;

COMMIT;
