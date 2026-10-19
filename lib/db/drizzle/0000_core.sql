CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('delivery', 'redemption', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('participant', 'verifier', 'admin');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_movements_delta_check" CHECK ("point_movements"."delta" <> 0),
	CONSTRAINT "point_movements_direction_check" CHECK (
    ("point_movements"."kind" = 'delivery' and "point_movements"."delta" > 0)
    or ("point_movements"."kind" = 'redemption' and "point_movements"."delta" < 0)
    or "point_movements"."kind" = 'adjustment'
  )
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reward_id" uuid NOT NULL,
	"cost" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemptions_cost_check" CHECK ("redemptions"."cost" > 0),
	CONSTRAINT "redemptions_idempotency_length_check" CHECK (length("redemptions"."idempotency_key") between 8 and 128)
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"cost" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_title_length_check" CHECK (length("rewards"."title") between 1 and 120),
	CONSTRAINT "rewards_description_length_check" CHECK (length("rewards"."description") <= 500),
	CONSTRAINT "rewards_cost_check" CHECK ("rewards"."cost" > 0)
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scans_category_length_check" CHECK (length("scans"."category") between 1 and 64),
	CONSTRAINT "scans_source_check" CHECK ("scans"."source" in ('manual', 'demo'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"role" "user_role" DEFAULT 'participant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"verifier_id" text NOT NULL,
	"decision" "delivery_status" NOT NULL,
	"verified_grams" integer,
	"receipt_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verifications_decision_check" CHECK ("verifications"."decision" in ('approved', 'rejected')),
	CONSTRAINT "verifications_weight_check" CHECK (
    ("verifications"."decision" = 'approved' and "verifications"."verified_grams" between 1 and 100000 and length("verifications"."receipt_code") between 8 and 64)
    or ("verifications"."decision" = 'rejected' and "verifications"."verified_grams" is null and "verifications"."receipt_code" is null)
  )
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_movements" ADD CONSTRAINT "point_movements_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verifier_id_users_clerk_user_id_fk" FOREIGN KEY ("verifier_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_user_created_idx" ON "deliveries" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "point_movements_source_unique" ON "point_movements" USING btree ("kind","source_id");--> statement-breakpoint
CREATE INDEX "point_movements_user_created_idx" ON "point_movements" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "redemptions_idempotency_unique" ON "redemptions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "redemptions_user_created_idx" ON "redemptions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scans_user_created_idx" ON "scans" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_delivery_unique" ON "verifications" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_receipt_unique" ON "verifications" USING btree ("receipt_code");--> statement-breakpoint
CREATE FUNCTION "public"."reject_point_movement_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'point movements are append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "point_movements_append_only"
BEFORE UPDATE OR DELETE ON "public"."point_movements"
FOR EACH ROW
EXECUTE FUNCTION "public"."reject_point_movement_mutation"();
