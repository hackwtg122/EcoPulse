CREATE TABLE "role_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_clerk_user_id" text NOT NULL,
	"target_clerk_user_id" text NOT NULL,
	"previous_role" "user_role" NOT NULL,
	"next_role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_change_events" ADD CONSTRAINT "role_change_events_actor_clerk_user_id_users_clerk_user_id_fk" FOREIGN KEY ("actor_clerk_user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_change_events" ADD CONSTRAINT "role_change_events_target_clerk_user_id_users_clerk_user_id_fk" FOREIGN KEY ("target_clerk_user_id") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_change_events_created_at_idx" ON "role_change_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "role_change_events_target_idx" ON "role_change_events" USING btree ("target_clerk_user_id","created_at" DESC NULLS LAST);