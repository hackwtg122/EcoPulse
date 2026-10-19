ALTER TABLE "redemptions" ADD COLUMN "fulfillment_status" text DEFAULT 'reserved' NOT NULL;--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "fulfillment_reference" text;--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "fulfilled_by" text;--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "fulfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "inventory_remaining" integer;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "fulfillment_reference" text;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_fulfilled_by_users_clerk_user_id_fk" FOREIGN KEY ("fulfilled_by") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_validated_by_users_clerk_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_fulfillment_reference_check" CHECK ("redemptions"."fulfillment_reference" is null or length("redemptions"."fulfillment_reference") between 10 and 120);--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_fulfillment_check" CHECK (("redemptions"."fulfillment_status" = 'reserved' and "redemptions"."fulfillment_reference" is null and "redemptions"."fulfilled_by" is null and "redemptions"."fulfilled_at" is null) or ("redemptions"."fulfillment_status" = 'fulfilled' and "redemptions"."fulfillment_reference" is not null and "redemptions"."fulfilled_by" is not null and "redemptions"."fulfilled_at" is not null));--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_inventory_check" CHECK ("rewards"."inventory_remaining" is null or "rewards"."inventory_remaining" between 0 and 100000);--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_fulfillment_reference_check" CHECK ("rewards"."fulfillment_reference" is null or length("rewards"."fulfillment_reference") between 10 and 500);--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_active_validated_check" CHECK (not "rewards"."active" or ("rewards"."inventory_remaining" > 0 and "rewards"."fulfillment_reference" is not null and "rewards"."validated_by" is not null and "rewards"."validated_at" is not null));--> statement-breakpoint
CREATE FUNCTION public.guard_reward_public_details()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.active AND (NEW.title, NEW.description, NEW.cost, NEW.fulfillment_reference, NEW.validated_by, NEW.validated_at)
    IS DISTINCT FROM (OLD.title, OLD.description, OLD.cost, OLD.fulfillment_reference, OLD.validated_by, OLD.validated_at) THEN
    RAISE EXCEPTION 'deactivate and revalidate reward before changing published details' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rewards_protect_published_details
BEFORE UPDATE ON public.rewards
FOR EACH ROW EXECUTE FUNCTION public.guard_reward_public_details();
