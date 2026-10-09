-- Review before applying to a dedicated pilot database. Never run automatically.
-- This is a manually authored initial migration; existing data must be assessed first.
BEGIN;

CREATE TYPE user_role AS ENUM ('participant', 'verifier', 'admin');
CREATE TYPE delivery_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE movement_kind AS ENUM ('delivery', 'redemption', 'adjustment');

CREATE TABLE users (
  clerk_user_id text PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'participant',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scans (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(clerk_user_id),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 64),
  source text NOT NULL CHECK (source IN ('manual', 'demo')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scans_user_created_idx ON scans(user_id, created_at DESC);

CREATE TABLE deliveries (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(clerk_user_id),
  status delivery_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_user_created_idx ON deliveries(user_id, created_at DESC);

CREATE TABLE verifications (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES deliveries(id),
  verifier_id text NOT NULL REFERENCES users(clerk_user_id),
  decision delivery_status NOT NULL CHECK (decision IN ('approved', 'rejected')),
  verified_grams integer,
  receipt_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verifications_delivery_unique UNIQUE (delivery_id),
  CONSTRAINT verifications_receipt_unique UNIQUE (receipt_code),
  CONSTRAINT verifications_weight_check CHECK (
    (decision = 'approved' AND verified_grams BETWEEN 1 AND 100000 AND length(receipt_code) BETWEEN 8 AND 64)
    OR (decision = 'rejected' AND verified_grams IS NULL AND receipt_code IS NULL)
  )
);

CREATE TABLE point_movements (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(clerk_user_id),
  delta integer NOT NULL CHECK (delta <> 0),
  kind movement_kind NOT NULL,
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_movements_source_unique UNIQUE (kind, source_id),
  CONSTRAINT point_movements_direction_check CHECK (
    (kind = 'delivery' AND delta > 0)
    OR (kind = 'redemption' AND delta < 0)
    OR kind = 'adjustment'
  )
);
CREATE INDEX point_movements_user_created_idx ON point_movements(user_id, created_at DESC);

CREATE FUNCTION reject_point_movement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'point movements are append-only';
END;
$$;
CREATE TRIGGER point_movements_append_only
  BEFORE UPDATE OR DELETE ON point_movements
  FOR EACH ROW EXECUTE FUNCTION reject_point_movement_mutation();

CREATE TABLE rewards (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) <= 500),
  cost integer NOT NULL CHECK (cost > 0),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE redemptions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(clerk_user_id),
  reward_id uuid NOT NULL REFERENCES rewards(id),
  cost integer NOT NULL CHECK (cost > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redemptions_idempotency_unique UNIQUE (user_id, idempotency_key)
);
CREATE INDEX redemptions_user_created_idx ON redemptions(user_id, created_at DESC);

COMMIT;
