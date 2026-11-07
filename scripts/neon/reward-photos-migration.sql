-- Physical product photographs: no stock, rewards or redemptions are created.
-- Apply after a restore-tested backup, then verify application-role permissions.
CREATE TABLE IF NOT EXISTS public.reward_photos (
  reward_id uuid PRIMARY KEY REFERENCES public.rewards(id),
  image_url text NOT NULL CHECK (char_length(image_url) BETWEEN 12 AND 800 AND image_url LIKE 'https://%'),
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 12 AND 800 AND source_url LIKE 'https://%'),
  confirmed_by text NOT NULL REFERENCES public.users(clerk_user_id),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.reward_photos IS 'ecopulse:verified-physical-reward-photo:v1';
REVOKE ALL ON public.reward_photos FROM PUBLIC;
GRANT SELECT, INSERT ON public.reward_photos TO ecopulse_app;
GRANT UPDATE (image_url, source_url, confirmed_by, confirmed_at) ON public.reward_photos TO ecopulse_app;
