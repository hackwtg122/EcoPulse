-- Additive ledger only: no rewards, inventory or business events are inserted.
CREATE TABLE public.reward_inventory_movements (
  id uuid PRIMARY KEY,
  reward_id uuid NOT NULL REFERENCES public.rewards(id),
  administrator_id text NOT NULL REFERENCES public.users(clerk_user_id),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  inventory_before integer NOT NULL CHECK (inventory_before BETWEEN 0 AND 100000),
  inventory_after integer NOT NULL CHECK (inventory_after BETWEEN 1 AND 100000 AND inventory_after = inventory_before + quantity),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 10 AND 500 AND evidence_reference LIKE 'https://%'),
  availability_confirmed boolean NOT NULL CHECK (availability_confirmed),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (administrator_id, idempotency_key)
);
COMMENT ON TABLE public.reward_inventory_movements IS 'ecopulse:reward-inventory:v1';
CREATE INDEX reward_inventory_history_idx ON public.reward_inventory_movements (reward_id, created_at DESC, id DESC);
CREATE FUNCTION public.reject_reward_inventory_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'reward inventory ledger is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER reward_inventory_immutable BEFORE UPDATE OR DELETE ON public.reward_inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.reject_reward_inventory_mutation();
REVOKE ALL ON public.reward_inventory_movements FROM PUBLIC;
GRANT SELECT, INSERT ON public.reward_inventory_movements TO ecopulse_app;
