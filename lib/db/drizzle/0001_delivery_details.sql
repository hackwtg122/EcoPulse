CREATE TYPE "public"."delivery_request_status" AS ENUM('pending', 'scheduled', 'received', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "delivery_idempotency" (
	"user_id" text NOT NULL,
	"operation" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "delivery_idempotency_pk" PRIMARY KEY("user_id","operation","key_hash"),
	CONSTRAINT "delivery_idempotency_operation_check" CHECK ("delivery_idempotency"."operation" in ('create', 'complete_details', 'cancel', 'reserve')),
	CONSTRAINT "delivery_idempotency_key_hash_check" CHECK ("delivery_idempotency"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "delivery_idempotency_request_hash_check" CHECK ("delivery_idempotency"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "delivery_idempotency_completion_check" CHECK (
    ("delivery_idempotency"."completed_at" is null and "delivery_idempotency"."delivery_id" is null)
    or ("delivery_idempotency"."completed_at" is not null and "delivery_idempotency"."delivery_id" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"delivery_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"estimated_grams" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_items_pk" PRIMARY KEY("delivery_id","category_code"),
	CONSTRAINT "delivery_items_estimated_grams_check" CHECK ("delivery_items"."estimated_grams" between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "delivery_points" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"municipality" text NOT NULL,
	"time_zone" text NOT NULL,
	"appointment_required" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_points_code_length_check" CHECK (length("delivery_points"."code") between 3 and 64),
	CONSTRAINT "delivery_points_name_length_check" CHECK (length("delivery_points"."name") between 1 and 160),
	CONSTRAINT "delivery_points_address_length_check" CHECK (length("delivery_points"."address") between 1 and 240),
	CONSTRAINT "delivery_points_municipality_length_check" CHECK (length("delivery_points"."municipality") between 1 and 120),
	CONSTRAINT "delivery_points_timezone_length_check" CHECK (length("delivery_points"."time_zone") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "delivery_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_point_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_slots_time_check" CHECK ("delivery_slots"."ends_at" > "delivery_slots"."starts_at"),
	CONSTRAINT "delivery_slots_duration_check" CHECK ("delivery_slots"."ends_at" <= "delivery_slots"."starts_at" + interval '8 hours'),
	CONSTRAINT "delivery_slots_capacity_check" CHECK ("delivery_slots"."capacity" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "delivery_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"actor_user_id" text,
	"from_status" "delivery_request_status",
	"to_status" "delivery_request_status" NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_status_events_transition_check" CHECK ("delivery_status_events"."from_status" is null or "delivery_status_events"."from_status" <> "delivery_status_events"."to_status"),
	CONSTRAINT "delivery_status_events_reason_length_check" CHECK ("delivery_status_events"."reason_code" is null or length("delivery_status_events"."reason_code") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "material_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_categories_code_check" CHECK ("material_categories"."code" in ('paper', 'plastic', 'glass', 'metal', 'organic', 'other'))
);
--> statement-breakpoint
INSERT INTO "material_categories" ("code") VALUES
  ('paper'),
  ('plastic'),
  ('glass'),
  ('metal'),
  ('organic'),
  ('other');--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DATA TYPE "public"."delivery_request_status" USING "status"::text::"public"."delivery_request_status";--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "request_version" smallint;--> statement-breakpoint
UPDATE "deliveries" SET "request_version" = 1 WHERE "request_version" IS NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "request_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "request_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "delivery_point_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "slot_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "deliveries" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_idempotency" ADD CONSTRAINT "delivery_idempotency_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_idempotency" ADD CONSTRAINT "delivery_idempotency_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_category_code_material_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."material_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_delivery_point_id_delivery_points_id_fk" FOREIGN KEY ("delivery_point_id") REFERENCES "public"."delivery_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_status_events" ADD CONSTRAINT "delivery_status_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_status_events" ADD CONSTRAINT "delivery_status_events_actor_user_id_users_clerk_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_idempotency_delivery_idx" ON "delivery_idempotency" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_items_category_idx" ON "delivery_items" USING btree ("category_code");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_points_code_unique" ON "delivery_points" USING btree ("code");--> statement-breakpoint
CREATE INDEX "delivery_points_active_name_idx" ON "delivery_points" USING btree ("active","name");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_slots_point_window_unique" ON "delivery_slots" USING btree ("delivery_point_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_slots_id_point_unique" ON "delivery_slots" USING btree ("id","delivery_point_id");--> statement-breakpoint
CREATE INDEX "delivery_slots_point_start_idx" ON "delivery_slots" USING btree ("delivery_point_id","starts_at");--> statement-breakpoint
CREATE INDEX "delivery_status_events_delivery_created_idx" ON "delivery_status_events" USING btree ("delivery_id","created_at","id");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivery_point_id_delivery_points_id_fk" FOREIGN KEY ("delivery_point_id") REFERENCES "public"."delivery_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_slot_point_fk" FOREIGN KEY ("slot_id","delivery_point_id") REFERENCES "public"."delivery_slots"("id","delivery_point_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_status_created_idx" ON "deliveries" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deliveries_slot_status_idx" ON "deliveries" USING btree ("slot_id","status");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_request_version_check" CHECK ("deliveries"."request_version" in (1, 2));--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_version_details_check" CHECK (
    ("deliveries"."request_version" = 1 and "deliveries"."delivery_point_id" is null and "deliveries"."slot_id" is null)
    or ("deliveries"."request_version" = 2 and "deliveries"."delivery_point_id" is not null)
  );--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_scheduled_slot_check" CHECK ("deliveries"."status" <> 'scheduled' or "deliveries"."slot_id" is not null);
CREATE FUNCTION "public"."enforce_delivery_destination"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  point_active boolean;
  requires_appointment boolean;
  slot_active boolean;
  slot_start timestamptz;
  slot_capacity integer;
  reserved_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.request_version <> OLD.request_version THEN
    RAISE EXCEPTION 'delivery request version is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.request_version = 1 THEN
    RETURN NEW;
  END IF;

  SELECT active, appointment_required
    INTO point_active, requires_appointment
    FROM delivery_points
    WHERE id = NEW.delivery_point_id
    FOR SHARE;

  IF NOT FOUND OR NOT point_active THEN
    RAISE EXCEPTION 'delivery point is unavailable' USING ERRCODE = '23514';
  END IF;

  IF NEW.slot_id IS NULL THEN
    IF requires_appointment THEN
      RAISE EXCEPTION 'an active slot is required for this delivery point' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT active, starts_at, capacity
    INTO slot_active, slot_start, slot_capacity
    FROM delivery_slots
    WHERE id = NEW.slot_id AND delivery_point_id = NEW.delivery_point_id
    FOR UPDATE;

  IF NOT FOUND OR NOT slot_active OR slot_start <= now() THEN
    RAISE EXCEPTION 'delivery slot is unavailable' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO reserved_count
    FROM deliveries
    WHERE slot_id = NEW.slot_id
      AND id <> NEW.id
      AND status NOT IN ('cancelled', 'rejected');

  IF reserved_count >= slot_capacity THEN
    RAISE EXCEPTION 'delivery slot capacity has been reached' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "deliveries_destination_guard"
BEFORE INSERT OR UPDATE OF "request_version", "delivery_point_id", "slot_id"
ON "public"."deliveries"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_delivery_destination"();--> statement-breakpoint

CREATE FUNCTION "public"."enforce_delivery_item_limits"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_delivery_id uuid;
  target_status delivery_request_status;
  target_version smallint;
  existing_count integer;
  existing_grams integer;
  category_active boolean;
BEGIN
  target_delivery_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.delivery_id ELSE NEW.delivery_id END;

  SELECT status, request_version
    INTO target_status, target_version
    FROM deliveries
    WHERE id = target_delivery_id
    FOR UPDATE;

  IF NOT FOUND OR target_version <> 2 THEN
    RAISE EXCEPTION 'delivery items require a version 2 delivery' USING ERRCODE = '23514';
  END IF;
  IF target_status <> 'pending' THEN
    RAISE EXCEPTION 'delivery items are immutable after pending' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.delivery_id <> OLD.delivery_id THEN
    RAISE EXCEPTION 'delivery items cannot move between deliveries' USING ERRCODE = '55000';
  END IF;

  SELECT active INTO category_active FROM material_categories WHERE code = NEW.category_code;
  IF NOT FOUND OR NOT category_active THEN
    RAISE EXCEPTION 'material category is unavailable' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT count(*)::integer, coalesce(sum(estimated_grams), 0)::integer
      INTO existing_count, existing_grams
      FROM delivery_items
      WHERE delivery_id = NEW.delivery_id
        AND (delivery_id, category_code) <> (OLD.delivery_id, OLD.category_code);
  ELSE
    SELECT count(*)::integer, coalesce(sum(estimated_grams), 0)::integer
      INTO existing_count, existing_grams
      FROM delivery_items
      WHERE delivery_id = NEW.delivery_id;
  END IF;

  IF existing_count >= 6 OR existing_grams + NEW.estimated_grams > 100000 THEN
    RAISE EXCEPTION 'delivery material limits exceeded' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "delivery_items_limits_guard"
BEFORE INSERT OR UPDATE OR DELETE
ON "public"."delivery_items"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_delivery_item_limits"();--> statement-breakpoint

CREATE FUNCTION "public"."ensure_delivery_has_items"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_delivery_id uuid;
  target_version smallint;
BEGIN
  IF TG_TABLE_NAME = 'deliveries' THEN
    target_delivery_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_delivery_id := OLD.delivery_id;
  ELSE
    target_delivery_id := NEW.delivery_id;
  END IF;

  SELECT request_version INTO target_version FROM deliveries WHERE id = target_delivery_id;
  IF FOUND AND target_version = 2 AND NOT EXISTS (
    SELECT 1 FROM delivery_items WHERE delivery_id = target_delivery_id
  ) THEN
    RAISE EXCEPTION 'version 2 deliveries require at least one material' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "deliveries_require_items"
AFTER INSERT OR UPDATE OF "request_version"
ON "public"."deliveries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."ensure_delivery_has_items"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "delivery_items_preserve_details"
AFTER INSERT OR UPDATE OR DELETE
ON "public"."delivery_items"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."ensure_delivery_has_items"();--> statement-breakpoint

CREATE FUNCTION "public"."enforce_delivery_status_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('scheduled', 'received', 'cancelled'))
    OR (OLD.status = 'scheduled' AND NEW.status IN ('received', 'cancelled'))
    OR (OLD.status = 'received' AND NEW.status IN ('approved', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'invalid delivery status transition' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "deliveries_status_transition_guard"
BEFORE UPDATE OF "status" ON "public"."deliveries"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_delivery_status_transition"();--> statement-breakpoint

CREATE FUNCTION "public"."ensure_delivery_status_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.request_version = 2 AND NOT EXISTS (
      SELECT 1
      FROM delivery_status_events
      WHERE delivery_id = NEW.id
        AND from_status IS NULL
        AND to_status = NEW.status
        AND created_at >= transaction_timestamp()
    ) THEN
      RAISE EXCEPTION 'detailed delivery creation requires an initial audit event' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status <> OLD.status AND NOT EXISTS (
    SELECT 1
    FROM delivery_status_events
    WHERE delivery_id = NEW.id
      AND from_status = OLD.status
      AND to_status = NEW.status
      AND created_at >= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'delivery status transition requires an audit event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "deliveries_require_initial_status_event"
AFTER INSERT ON "public"."deliveries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."ensure_delivery_status_event"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "deliveries_require_status_event"
AFTER UPDATE OF "status" ON "public"."deliveries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."ensure_delivery_status_event"();--> statement-breakpoint
CREATE FUNCTION "public"."set_delivery_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "deliveries_set_updated_at"
BEFORE UPDATE ON "public"."deliveries"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_delivery_updated_at"();--> statement-breakpoint

CREATE FUNCTION "public"."reject_delivery_status_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'delivery status events are append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "delivery_status_events_append_only"
BEFORE UPDATE OR DELETE ON "public"."delivery_status_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."reject_delivery_status_event_mutation"();

