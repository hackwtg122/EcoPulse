CREATE TABLE public.platform_activation_events (
  revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  administrator_id text NOT NULL REFERENCES public.users(clerk_user_id),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  flags jsonb NOT NULL CHECK (jsonb_typeof(flags)='object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(administrator_id,idempotency_key)
);
COMMENT ON TABLE public.platform_activation_events IS 'ecopulse:platform-activation:v1';
CREATE FUNCTION public.reject_platform_activation_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'platform activation audit is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER platform_activation_events_immutable BEFORE UPDATE OR DELETE ON public.platform_activation_events
FOR EACH ROW EXECUTE FUNCTION public.reject_platform_activation_mutation();
CREATE TRIGGER platform_activation_events_no_truncate BEFORE TRUNCATE ON public.platform_activation_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_platform_activation_mutation();
REVOKE ALL ON public.platform_activation_events FROM PUBLIC;
GRANT SELECT,INSERT ON public.platform_activation_events TO ecopulse_app;
GRANT USAGE ON SEQUENCE public.platform_activation_events_revision_seq TO ecopulse_app;
