-- PREPARADO: NO EJECUTAR SIN AUTORIZACION DE PERMISOS.
-- Unicamente 127.0.0.1:5432/ecopulse_dev como ecopulse_migrator.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'ecopulse_dev' OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR inet_server_port() <> 5432 OR current_user <> 'ecopulse_migrator' THEN
    RAISE EXCEPTION 'Expected local ecopulse_dev migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rewards' AND column_name='inventory_remaining') THEN
    RAISE EXCEPTION '0003_reward_fulfillment must be applied first';
  END IF;
END;
$$;
-- No permiso para activar, validar, alterar inventario o borrar.
GRANT INSERT (id,title,description,cost) ON public.rewards TO ecopulse_app;
GRANT UPDATE (title,description,cost) ON public.rewards TO ecopulse_app;
COMMIT;
