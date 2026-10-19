-- PREPARADO: NO EJECUTAR SIN AUTORIZACION DE PERMISOS Y POLITICA DE CANJE.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'ecopulse_dev' OR inet_server_addr() IS DISTINCT FROM inet '127.0.0.1'
    OR inet_server_port() <> 5432 OR current_user <> 'ecopulse_migrator' THEN
    RAISE EXCEPTION 'Expected local ecopulse_dev migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='redemptions' AND column_name='fulfillment_status') THEN
    RAISE EXCEPTION '0003_reward_fulfillment must be applied first';
  END IF;
END;
$$;
-- Solo el débito transaccional puede consumir inventario; la ruta admin requiere rol admin.
GRANT UPDATE (inventory_remaining,active,updated_at) ON public.rewards TO ecopulse_app;
GRANT UPDATE (fulfillment_status,fulfillment_reference,fulfilled_by,fulfilled_at)
  ON public.redemptions TO ecopulse_app;
COMMIT;
