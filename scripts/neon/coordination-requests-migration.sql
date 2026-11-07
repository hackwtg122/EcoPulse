-- Additive migration for pending coordination requests (drizzle 0005).
-- Created separately from deliveries: a coordination request never claims a
-- center, a receipt or EcoPuntos until an administrator assigns one.
CREATE TYPE public.coordination_request_status AS ENUM ('pending', 'assigned', 'cancelled');

CREATE TABLE public.coordination_requests (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(clerk_user_id),
  status public.coordination_request_status NOT NULL DEFAULT 'pending',
  note text,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  delivery_id uuid REFERENCES public.deliveries(id),
  assigned_point_id uuid REFERENCES public.delivery_points(id),
  assigned_by text REFERENCES public.users(clerk_user_id),
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordination_requests_note_check CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  CONSTRAINT coordination_requests_state_check CHECK (
    (status = 'pending' AND delivery_id IS NULL AND assigned_point_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
    OR (status = 'assigned' AND delivery_id IS NOT NULL AND assigned_point_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    OR (status = 'cancelled' AND delivery_id IS NULL AND assigned_point_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
  )
);

CREATE TABLE public.coordination_request_items (
  request_id uuid NOT NULL REFERENCES public.coordination_requests(id),
  category_code text NOT NULL REFERENCES public.material_categories(code),
  estimated_grams integer NOT NULL CHECK (estimated_grams BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordination_request_items_pk PRIMARY KEY (request_id, category_code)
);

CREATE TABLE public.coordination_request_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.coordination_requests(id),
  actor_user_id text REFERENCES public.users(clerk_user_id),
  from_status public.coordination_request_status,
  to_status public.coordination_request_status NOT NULL,
  reason_code text CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coordination_request_events_transition_check CHECK (from_status IS NULL OR from_status <> to_status)
);

CREATE UNIQUE INDEX coordination_requests_delivery_unique ON public.coordination_requests(delivery_id);
CREATE INDEX coordination_requests_user_created_idx ON public.coordination_requests(user_id, created_at DESC, id DESC);
CREATE INDEX coordination_requests_status_created_idx ON public.coordination_requests(status, created_at DESC, id DESC);
CREATE INDEX coordination_request_items_category_idx ON public.coordination_request_items(category_code);
CREATE INDEX coordination_request_events_request_created_idx ON public.coordination_request_events(request_id, created_at, id);

COMMENT ON TABLE public.coordination_requests IS 'ecopulse:coordination-requests:v1';
COMMENT ON TABLE public.coordination_request_items IS 'ecopulse:coordination-requests:v1';
COMMENT ON TABLE public.coordination_request_events IS 'ecopulse:coordination-requests:v1';

REVOKE ALL ON public.coordination_requests, public.coordination_request_items, public.coordination_request_events FROM PUBLIC;
