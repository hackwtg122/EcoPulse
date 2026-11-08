ALTER TYPE "public"."movement_kind" ADD VALUE 'education';--> statement-breakpoint
CREATE TABLE "eco_challenge_admin_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"previous_state" jsonb,
	"next_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eco_challenge_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"answers" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eco_challenge_awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eco_awards_points_check" CHECK ("eco_challenge_awards"."points" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "eco_challenge_drafts" (
	"user_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eco_challenge_drafts_user_id_challenge_id_pk" PRIMARY KEY("user_id","challenge_id")
);
--> statement-breakpoint
CREATE TABLE "eco_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"questions" jsonb NOT NULL,
	"points" integer DEFAULT 10 NOT NULL,
	"pass_percent" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eco_challenges_points_check" CHECK ("eco_challenges"."points" between 1 and 1000),
	CONSTRAINT "eco_challenges_pass_check" CHECK ("eco_challenges"."pass_percent" between 50 and 100),
	CONSTRAINT "eco_challenges_questions_check" CHECK (jsonb_typeof("eco_challenges"."questions")='array' and jsonb_array_length("eco_challenges"."questions") between 2 and 10)
);
--> statement-breakpoint
ALTER TABLE "point_movements" DROP CONSTRAINT "point_movements_direction_check";--> statement-breakpoint
ALTER TABLE "eco_challenge_admin_events" ADD CONSTRAINT "eco_challenge_admin_events_actor_id_users_clerk_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_admin_events" ADD CONSTRAINT "eco_challenge_admin_events_challenge_id_eco_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."eco_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_attempts" ADD CONSTRAINT "eco_challenge_attempts_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_attempts" ADD CONSTRAINT "eco_challenge_attempts_challenge_id_eco_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."eco_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_awards" ADD CONSTRAINT "eco_challenge_awards_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_awards" ADD CONSTRAINT "eco_challenge_awards_challenge_id_eco_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."eco_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_awards" ADD CONSTRAINT "eco_challenge_awards_attempt_id_eco_challenge_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."eco_challenge_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_drafts" ADD CONSTRAINT "eco_challenge_drafts_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_challenge_drafts" ADD CONSTRAINT "eco_challenge_drafts_challenge_id_eco_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."eco_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eco_attempts_user_key_unique" ON "eco_challenge_attempts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "eco_attempts_user_created_idx" ON "eco_challenge_attempts" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "eco_attempts_challenge_idx" ON "eco_challenge_attempts" USING btree ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eco_awards_user_challenge_unique" ON "eco_challenge_awards" USING btree ("user_id","challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eco_awards_attempt_unique" ON "eco_challenge_awards" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eco_challenges_slug_unique" ON "eco_challenges" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "point_movements" ADD CONSTRAINT "point_movements_direction_check" CHECK (
    ("point_movements"."kind" = 'delivery' and "point_movements"."delta" > 0)
    or ("point_movements"."kind" = 'redemption' and "point_movements"."delta" < 0)
    or ("point_movements"."kind"::text = 'education' and "point_movements"."delta" > 0)
    or "point_movements"."kind" = 'adjustment'
  );
--> statement-breakpoint
COMMENT ON TABLE public.eco_challenges IS 'ecopulse:challenges:v1';
COMMENT ON TABLE public.eco_challenge_attempts IS 'ecopulse:challenges:v1';
COMMENT ON TABLE public.eco_challenge_awards IS 'ecopulse:challenges:v1';
COMMENT ON TABLE public.eco_challenge_drafts IS 'ecopulse:challenges:v1';
COMMENT ON TABLE public.eco_challenge_admin_events IS 'ecopulse:challenges:v1';
--> statement-breakpoint
CREATE FUNCTION public.reject_challenge_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'challenge audit is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER eco_attempts_immutable BEFORE UPDATE OR DELETE ON public.eco_challenge_attempts FOR EACH ROW EXECUTE FUNCTION public.reject_challenge_audit_mutation();
CREATE TRIGGER eco_attempts_no_truncate BEFORE TRUNCATE ON public.eco_challenge_attempts FOR EACH STATEMENT EXECUTE FUNCTION public.reject_challenge_audit_mutation();
CREATE TRIGGER eco_awards_immutable BEFORE UPDATE OR DELETE ON public.eco_challenge_awards FOR EACH ROW EXECUTE FUNCTION public.reject_challenge_audit_mutation();
CREATE TRIGGER eco_awards_no_truncate BEFORE TRUNCATE ON public.eco_challenge_awards FOR EACH STATEMENT EXECUTE FUNCTION public.reject_challenge_audit_mutation();
CREATE TRIGGER eco_admin_events_immutable BEFORE UPDATE OR DELETE ON public.eco_challenge_admin_events FOR EACH ROW EXECUTE FUNCTION public.reject_challenge_audit_mutation();
CREATE TRIGGER eco_admin_events_no_truncate BEFORE TRUNCATE ON public.eco_challenge_admin_events FOR EACH STATEMENT EXECUTE FUNCTION public.reject_challenge_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_challenge_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.slug,NEW.title,NEW.description,NEW.questions,NEW.points,NEW.pass_percent)
    IS DISTINCT FROM (OLD.slug,OLD.title,OLD.description,OLD.questions,OLD.points,OLD.pass_percent)
    AND EXISTS(SELECT 1 FROM eco_challenge_attempts WHERE challenge_id=OLD.id) THEN
    RAISE EXCEPTION 'challenge definition has attempts' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER eco_challenge_definition_guard BEFORE UPDATE ON public.eco_challenges FOR EACH ROW EXECUTE FUNCTION public.guard_challenge_definition();
--> statement-breakpoint
CREATE FUNCTION public.guard_challenge_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE c eco_challenges%ROWTYPE; i integer; selected integer; correct_count integer:=0; total integer;
BEGIN
  SELECT * INTO STRICT c FROM eco_challenges WHERE id=NEW.challenge_id FOR SHARE;
  total:=jsonb_array_length(c.questions);
  IF NOT c.active OR jsonb_typeof(NEW.answers)<>'array' OR jsonb_array_length(NEW.answers)<>total THEN
    RAISE EXCEPTION 'invalid challenge answers' USING ERRCODE='23514';
  END IF;
  FOR i IN 0..total-1 LOOP
    IF jsonb_typeof(NEW.answers->i)<>'number' OR (NEW.answers->>i)!~'^[0-9]+$' THEN RAISE EXCEPTION 'invalid answer index' USING ERRCODE='23514'; END IF;
    selected:=(NEW.answers->>i)::integer;
    IF selected>=jsonb_array_length(c.questions->i->'options') THEN RAISE EXCEPTION 'invalid answer option' USING ERRCODE='23514'; END IF;
    IF selected=(c.questions->i->>'correctIndex')::integer THEN correct_count:=correct_count+1; END IF;
  END LOOP;
  IF NEW.passed IS DISTINCT FROM (correct_count*100>=c.pass_percent*total)
    OR (NEW.result->>'correct')::integer IS DISTINCT FROM correct_count
    OR (NEW.result->>'total')::integer IS DISTINCT FROM total
    OR (NEW.result->>'passed')::boolean IS DISTINCT FROM NEW.passed THEN
    RAISE EXCEPTION 'challenge result mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER eco_challenge_attempt_guard BEFORE INSERT ON public.eco_challenge_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_challenge_attempt();
--> statement-breakpoint
CREATE FUNCTION public.guard_challenge_credit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='eco_challenge_awards' THEN
    IF NOT EXISTS(SELECT 1 FROM eco_challenge_attempts a JOIN eco_challenges c ON c.id=a.challenge_id
      WHERE a.id=NEW.attempt_id AND a.user_id=NEW.user_id AND a.challenge_id=NEW.challenge_id
      AND a.passed=true AND NEW.points=c.points AND (a.result->>'awardedPoints')::integer=NEW.points) THEN
      RAISE EXCEPTION 'award requires a passing attempt' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.kind::text='education' THEN
    IF NOT EXISTS(SELECT 1 FROM eco_challenge_awards a WHERE a.id=NEW.source_id AND a.user_id=NEW.user_id AND a.points=NEW.delta) THEN
      RAISE EXCEPTION 'credit requires a matching award' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER eco_award_guard BEFORE INSERT ON public.eco_challenge_awards FOR EACH ROW EXECUTE FUNCTION public.guard_challenge_credit();
CREATE TRIGGER eco_movement_guard BEFORE INSERT ON public.point_movements FOR EACH ROW EXECUTE FUNCTION public.guard_challenge_credit();
--> statement-breakpoint
CREATE FUNCTION public.require_challenge_movement() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM point_movements p WHERE p.kind::text='education' AND p.source_id=NEW.id AND p.user_id=NEW.user_id AND p.delta=NEW.points) THEN
    RAISE EXCEPTION 'award and movement must commit together' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER eco_award_requires_movement AFTER INSERT ON public.eco_challenge_awards
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_challenge_movement();
--> statement-breakpoint
REVOKE ALL ON public.eco_challenges,public.eco_challenge_attempts,public.eco_challenge_awards,public.eco_challenge_drafts,public.eco_challenge_admin_events FROM PUBLIC;
GRANT SELECT,INSERT ON public.eco_challenges,public.eco_challenge_attempts,public.eco_challenge_awards,public.eco_challenge_drafts,public.eco_challenge_admin_events TO ecopulse_app;
GRANT UPDATE(slug,title,description,questions,points,pass_percent,active) ON public.eco_challenges TO ecopulse_app;
GRANT UPDATE(answers,updated_at) ON public.eco_challenge_drafts TO ecopulse_app;
