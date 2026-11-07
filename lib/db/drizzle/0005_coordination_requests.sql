CREATE TYPE "public"."coordination_request_status" AS ENUM('pending', 'assigned', 'cancelled');--> statement-breakpoint
CREATE TABLE "coordination_request_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_user_id" text,
	"from_status" "coordination_request_status",
	"to_status" "coordination_request_status" NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordination_request_events_transition_check" CHECK ("coordination_request_events"."from_status" is null or "coordination_request_events"."from_status" <> "coordination_request_events"."to_status"),
	CONSTRAINT "coordination_request_events_reason_check" CHECK ("coordination_request_events"."reason_code" is null or length("coordination_request_events"."reason_code") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "coordination_request_items" (
	"request_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"estimated_grams" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordination_request_items_pk" PRIMARY KEY("request_id","category_code"),
	CONSTRAINT "coordination_request_items_grams_check" CHECK ("coordination_request_items"."estimated_grams" between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "coordination_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "coordination_request_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"request_hash" text NOT NULL,
	"delivery_id" uuid,
	"assigned_point_id" uuid,
	"assigned_by" text,
	"assigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordination_requests_note_check" CHECK ("coordination_requests"."note" is null or length("coordination_requests"."note") between 1 and 500),
	CONSTRAINT "coordination_requests_hash_check" CHECK ("coordination_requests"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "coordination_requests_state_check" CHECK (
    ("coordination_requests"."status" = 'pending' and "coordination_requests"."delivery_id" is null and "coordination_requests"."assigned_point_id" is null and "coordination_requests"."assigned_by" is null and "coordination_requests"."assigned_at" is null)
    or ("coordination_requests"."status" = 'assigned' and "coordination_requests"."delivery_id" is not null and "coordination_requests"."assigned_point_id" is not null and "coordination_requests"."assigned_by" is not null and "coordination_requests"."assigned_at" is not null)
    or ("coordination_requests"."status" = 'cancelled' and "coordination_requests"."delivery_id" is null and "coordination_requests"."assigned_point_id" is null and "coordination_requests"."assigned_by" is null and "coordination_requests"."assigned_at" is null)
  )
);
--> statement-breakpoint
ALTER TABLE "coordination_request_events" ADD CONSTRAINT "coordination_request_events_request_id_coordination_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."coordination_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_request_events" ADD CONSTRAINT "coordination_request_events_actor_user_id_users_clerk_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_request_items" ADD CONSTRAINT "coordination_request_items_request_id_coordination_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."coordination_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_request_items" ADD CONSTRAINT "coordination_request_items_category_code_material_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."material_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_requests" ADD CONSTRAINT "coordination_requests_user_id_users_clerk_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_requests" ADD CONSTRAINT "coordination_requests_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_requests" ADD CONSTRAINT "coordination_requests_assigned_point_id_delivery_points_id_fk" FOREIGN KEY ("assigned_point_id") REFERENCES "public"."delivery_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordination_requests" ADD CONSTRAINT "coordination_requests_assigned_by_users_clerk_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coordination_request_events_request_created_idx" ON "coordination_request_events" USING btree ("request_id","created_at","id");--> statement-breakpoint
CREATE INDEX "coordination_request_items_category_idx" ON "coordination_request_items" USING btree ("category_code");--> statement-breakpoint
CREATE UNIQUE INDEX "coordination_requests_delivery_unique" ON "coordination_requests" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "coordination_requests_user_created_idx" ON "coordination_requests" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coordination_requests_status_created_idx" ON "coordination_requests" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);