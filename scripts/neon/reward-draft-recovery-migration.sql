CREATE TABLE public.reward_draft_recoveries (
  id uuid PRIMARY KEY,
  reward_id uuid NOT NULL REFERENCES public.rewards(id),
  administrator_id text NOT NULL REFERENCES public.users(clerk_user_id),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  previous_state jsonb NOT NULL CHECK (jsonb_typeof(previous_state)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (administrator_id,idempotency_key)
);
COMMENT ON TABLE public.reward_draft_recoveries IS 'ecopulse:reward-draft-recovery:v1';
CREATE INDEX reward_draft_recovery_history_idx ON public.reward_draft_recoveries(reward_id,created_at DESC,id DESC);
CREATE FUNCTION public.reject_reward_draft_recovery_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'reward draft recovery audit is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER reward_draft_recoveries_immutable BEFORE UPDATE OR DELETE ON public.reward_draft_recoveries
FOR EACH ROW EXECUTE FUNCTION public.reject_reward_draft_recovery_mutation();
REVOKE ALL ON public.reward_draft_recoveries FROM PUBLIC;
GRANT SELECT,INSERT ON public.reward_draft_recoveries TO ecopulse_app;
