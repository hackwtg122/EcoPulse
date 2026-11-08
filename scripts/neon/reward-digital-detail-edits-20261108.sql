-- Authorized editing of descriptions and future prices for published digital rewards.
-- Existing redemption costs, fulfillment files and redemption history remain unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reward_detail_edit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id uuid NOT NULL REFERENCES public.rewards(id) ON DELETE RESTRICT,
  administrator_id text NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE RESTRICT,
  previous_description text NOT NULL,
  new_description text NOT NULL,
  previous_cost integer NOT NULL,
  new_cost integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_detail_edits_by_reward
  ON public.reward_detail_edit_events(reward_id, changed_at DESC);
CREATE OR REPLACE FUNCTION public.guard_reward_public_details()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE
  editor text;
BEGIN
  -- A published reward retains immutable identity and fulfillment evidence.
  IF OLD.active AND (NEW.title, NEW.fulfillment_reference, NEW.validated_by, NEW.validated_at)
    IS DISTINCT FROM (OLD.title, OLD.fulfillment_reference, OLD.validated_by, OLD.validated_at) THEN
    RAISE EXCEPTION 'immutable published reward identity or fulfillment data'
      USING ERRCODE='23514';
  END IF;
  IF (OLD.active OR OLD.validated_at IS NOT NULL) AND
     (NEW.description,NEW.cost) IS DISTINCT FROM (OLD.description,OLD.cost) THEN
    editor := current_setting('ecopulse.reward_detail_editor',true);
    IF editor IS NULL OR editor='' OR NOT EXISTS(
      SELECT 1 FROM public.users WHERE clerk_user_id=editor AND role='admin'
    ) THEN RAISE EXCEPTION 'reward detail changes require an authenticated administrator'
      USING ERRCODE='42501'; END IF;
    -- This exception applies exclusively to the three immutable known digital assets.
    IF NOT (OLD.fulfillment_reference LIKE 'https://ecopulse-3xb4.onrender.com/api/resources/digital/%') THEN
      RAISE EXCEPTION 'published physical rewards remain immutable'
        USING ERRCODE='23514';
    END IF;
    INSERT INTO public.reward_detail_edit_events
      (reward_id,administrator_id,previous_description,new_description,previous_cost,new_cost)
    VALUES(OLD.id,editor,OLD.description,NEW.description,OLD.cost,NEW.cost);
  END IF;
  RETURN NEW;
END $$;
GRANT SELECT, INSERT ON public.reward_detail_edit_events TO ecopulse_app;
COMMIT;
