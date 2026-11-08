-- EcoPulse: administrator schedules REAL handoff details for a digitally accepted
-- request. This is not a physical receipt, weight verification, or point award.
CREATE TABLE IF NOT EXISTS public.delivery_coordination_plans (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE RESTRICT,
  planned_by text NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE RESTRICT,
  handoff_address text NOT NULL CHECK (char_length(handoff_address) BETWEEN 8 AND 200),
  handoff_at timestamptz NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  plan_hash char(64) NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_coordination_plans_unique UNIQUE (delivery_id, plan_hash)
);
CREATE INDEX IF NOT EXISTS delivery_coordination_plans_latest_idx
  ON public.delivery_coordination_plans (delivery_id, created_at DESC, id DESC);
CREATE OR REPLACE FUNCTION public.prevent_delivery_plan_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery coordination planning is append-only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER delivery_coordination_plans_append_only
BEFORE UPDATE OR DELETE ON public.delivery_coordination_plans
FOR EACH ROW EXECUTE FUNCTION public.prevent_delivery_plan_mutation();
GRANT SELECT, INSERT ON public.delivery_coordination_plans TO ecopulse_app;
