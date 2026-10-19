-- PREPARADO PARA UNA FASE POSTERIOR. NO EJECUTAR SIN AUTORIZACION DE PUBLICACION.
-- El backend debe mantener PILOT_CATALOG_PUBLICATION_ENABLED=false hasta validar
-- centros y horarios reales, evidencia y controles de roles en la API.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'ecopulse_dev'
    OR inet_server_addr() <> '127.0.0.1'::inet
    OR inet_server_port() <> 5432
    OR current_user <> 'ecopulse_migrator' THEN
    RAISE EXCEPTION 'Expected local ecopulse_dev with ecopulse_migrator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delivery_points'
      AND column_name = 'validated_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delivery_slots'
      AND column_name = 'validated_at'
  ) THEN
    RAISE EXCEPTION 'Catalog validation schema is missing';
  END IF;
END;
$$;
GRANT UPDATE (validation_reference, validated_by, validated_at, active)
ON public.delivery_points TO ecopulse_app;
GRANT UPDATE (validation_reference, validated_by, validated_at, active)
ON public.delivery_slots TO ecopulse_app;
COMMIT;