-- ECO PULSE: accept the DIGITAL delivery request for administrative coordination.
-- Does not assert physical receipt, measured weight, reservation, or EcoPuntos.
-- Acceptance is append-only and independent of the existing delivery status lifecycle.
BEGIN;
CREATE TABLE IF NOT EXISTS public.delivery_request_acceptances (
  delivery_id uuid PRIMARY KEY REFERENCES public.deliveries(id) ON DELETE RESTRICT,
  accepted_by text NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.prevent_delivery_acceptance_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery request acceptance is append-only' USING ERRCODE='55000';
END $$;
DROP TRIGGER IF EXISTS delivery_request_acceptances_append_only ON public.delivery_request_acceptances;
CREATE TRIGGER delivery_request_acceptances_append_only
BEFORE UPDATE OR DELETE ON public.delivery_request_acceptances
FOR EACH ROW EXECUTE FUNCTION public.prevent_delivery_acceptance_mutation();
GRANT SELECT, INSERT ON public.delivery_request_acceptances TO ecopulse_app;
COMMIT;
