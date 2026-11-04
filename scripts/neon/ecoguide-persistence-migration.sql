-- Additive standalone migration, like favorite_centers and delivery_point_materials.
-- Deliberately does not rewrite the existing Drizzle migration journal.
CREATE TABLE public.guide_conversations (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE RESTRICT,
  creation_key text NOT NULL CHECK (creation_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  storage_consented_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, creation_key)
);
CREATE INDEX guide_conversations_user_updated_idx ON public.guide_conversations(user_id, updated_at DESC, id);
CREATE TABLE public.guide_turns (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  user_id text NOT NULL,
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  question_hash text NOT NULL CHECK (question_hash ~ '^[a-f0-9]{64}$'),
  question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 500),
  answer text CHECK (length(btrim(answer)) BETWEEN 1 AND 800),
  status text NOT NULL CHECK (status IN ('pending','completed','failed')),
  attempt_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id,user_id) REFERENCES public.guide_conversations(id,user_id) ON DELETE CASCADE,
  UNIQUE (conversation_id,request_key),
  CHECK ((status='completed' AND answer IS NOT NULL) OR (status<>'completed' AND answer IS NULL))
);
CREATE INDEX guide_turns_conversation_created_idx ON public.guide_turns(conversation_id,created_at,id);
CREATE UNIQUE INDEX guide_turns_one_pending_idx ON public.guide_turns(conversation_id) WHERE status='pending';
ALTER TABLE public.guide_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guide_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guide_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guide_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY guide_conversations_owner ON public.guide_conversations
  USING (user_id=current_setting('app.guide_user_id',true))
  WITH CHECK (user_id=current_setting('app.guide_user_id',true));
CREATE POLICY guide_turns_owner ON public.guide_turns
  USING (user_id=current_setting('app.guide_user_id',true))
  WITH CHECK (user_id=current_setting('app.guide_user_id',true));
REVOKE ALL ON public.guide_conversations,public.guide_turns FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.guide_conversations,public.guide_turns TO ecopulse_app;
COMMENT ON TABLE public.guide_conversations IS 'ecopulse:ecoguide-persistence:v1';
COMMENT ON TABLE public.guide_turns IS 'ecopulse:ecoguide-persistence:v1';
