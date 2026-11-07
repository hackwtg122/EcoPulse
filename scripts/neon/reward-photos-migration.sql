-- Physical product photographs: no stock, rewards or redemptions are created.
-- Apply after a restore-tested backup, then verify application-role permissions.
CREATE TABLE public.reward_photos (
  reward_id uuid PRIMARY KEY REFERENCES public.rewards(id),
  image_url text NOT NULL CHECK (char_length(image_url) BETWEEN 12 AND 800 AND image_url LIKE 'https://%'),
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 12 AND 800 AND source_url LIKE 'https://%'),
  confirmed_by text NOT NULL REFERENCES public.users(clerk_user_id),
  product_title text NOT NULL,
  product_description text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.reward_photos IS 'ecopulse:verified-physical-reward-photo:v1';
REVOKE ALL ON public.reward_photos FROM PUBLIC;
GRANT SELECT, INSERT ON public.reward_photos TO ecopulse_app;
GRANT UPDATE (image_url, source_url, confirmed_by, confirmed_at) ON public.reward_photos TO ecopulse_app;
GRANT UPDATE (product_title,product_description) ON public.reward_photos TO ecopulse_app;
CREATE TABLE public.reward_photo_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reward_id uuid NOT NULL REFERENCES public.rewards(id),
  actor_id text NOT NULL REFERENCES public.users(clerk_user_id),
  previous_photo jsonb,
  new_photo jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.reward_photo_events IS 'ecopulse:verified-physical-reward-photo:v1';
CREATE FUNCTION public.reject_reward_photo_event_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'photo audit is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER reward_photo_events_immutable BEFORE UPDATE OR DELETE ON public.reward_photo_events
FOR EACH ROW EXECUTE FUNCTION public.reject_reward_photo_event_mutation();
CREATE TRIGGER reward_photo_events_no_truncate BEFORE TRUNCATE ON public.reward_photo_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_reward_photo_event_mutation();
REVOKE ALL ON public.reward_photo_events FROM PUBLIC;
GRANT SELECT,INSERT ON public.reward_photo_events TO ecopulse_app;
GRANT USAGE ON SEQUENCE public.reward_photo_events_id_seq TO ecopulse_app;
CREATE TABLE public.reward_withdrawal_events (
  reward_id uuid PRIMARY KEY REFERENCES public.rewards(id),
  actor_id text NOT NULL REFERENCES public.users(clerk_user_id),
  previous_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER reward_withdrawal_events_immutable BEFORE UPDATE OR DELETE ON public.reward_withdrawal_events
FOR EACH ROW EXECUTE FUNCTION public.reject_reward_photo_event_mutation();
CREATE TRIGGER reward_withdrawal_events_no_truncate BEFORE TRUNCATE ON public.reward_withdrawal_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_reward_photo_event_mutation();
REVOKE ALL ON public.reward_withdrawal_events FROM PUBLIC;
GRANT SELECT,INSERT ON public.reward_withdrawal_events TO ecopulse_app;
