-- Alternativa manual a lib/db/scripts/eval-bootstrap.mjs (NO usar ambas).
-- Este método NO actualiza el journal de Drizzle: para una instalación nueva
-- usar el migrador oficial; conservar este archivo solo para inspección SQL.
-- Ejecutar SOLO con psql -X -v ON_ERROR_STOP=1 -f scripts/eval/db/drizzle/0000_eval_init.sql
-- Sobre una base ecopulse_eval NUEVA y VACÍA; nunca repetir en ecopulse_dev.
DO $$ BEGIN
  IF current_database() <> 'ecopulse_eval' THEN
    RAISE EXCEPTION 'Evaluation bootstrap requires ecopulse_eval';
  END IF;
  IF to_regclass('public.users') IS NOT NULL THEN
    RAISE EXCEPTION 'Evaluation bootstrap requires an empty database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecopulse_app') THEN
    RAISE EXCEPTION 'Existing ecopulse_app role required by 0002; no roles are created automatically';
  END IF;
END $$;
-- Usar las migraciones Drizzle originales en orden, sin reimplementarlas ni duplicar numeración.
\ir ../../../../lib/db/drizzle/0000_core.sql
\ir ../../../../lib/db/drizzle/0001_delivery_details.sql
\ir ../../../../lib/db/drizzle/0002_catalog_validation.sql
\ir ../../../../lib/db/drizzle/0003_reward_fulfillment.sql
