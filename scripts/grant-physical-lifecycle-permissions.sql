-- PREPARADO, NO EJECUTAR SIN AUTORIZACION ESPECIFICA.
-- Conectar como ecopulse_migrator solo a 127.0.0.1:5432/ecopulse_dev.
-- No activa acciones: PILOT_RECEIPT_ENABLED, PILOT_VERIFICATION_ENABLED y PILOT_POINTS_ENABLED permanecen false.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'ecopulse_dev'
    OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR inet_server_port() <> 5432
    OR current_user <> 'ecopulse_migrator' THEN
    RAISE EXCEPTION 'Expected local ecopulse_dev with ecopulse_migrator';
  END IF;
  IF to_regclass('public.delivery_status_events') IS NULL
    OR to_regclass('public.verifications') IS NULL
    OR to_regclass('public.point_movements') IS NULL THEN
    RAISE EXCEPTION 'Required physical verification tables are missing';
  END IF;
END;
$$;
-- El rol ya tiene SELECT de entregas/eventos, INSERT de eventos/verificaciones
-- y SELECT/INSERT de movimientos según los permisos existentes.
-- Este ajuste limita la modificación de entregas al estado y permite leer
-- únicamente las columnas necesarias para reintentos idempotentes.
REVOKE UPDATE ON public.deliveries FROM ecopulse_app;
GRANT UPDATE (status) ON public.deliveries TO ecopulse_app;
GRANT SELECT (id, delivery_id, verifier_id, decision, verified_grams, receipt_code)
  ON public.verifications TO ecopulse_app;
COMMIT;
