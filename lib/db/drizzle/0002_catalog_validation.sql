ALTER TABLE "delivery_points" ADD COLUMN "validation_reference" text;--> statement-breakpoint
ALTER TABLE "delivery_points" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "delivery_points" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD COLUMN "validation_reference" text;--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_points" ADD CONSTRAINT "delivery_points_validated_by_users_clerk_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_validated_by_users_clerk_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("clerk_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_points" ADD CONSTRAINT "delivery_points_validation_reference_check" CHECK ("delivery_points"."validation_reference" is null or length("delivery_points"."validation_reference") between 10 and 500);--> statement-breakpoint
ALTER TABLE "delivery_points" ADD CONSTRAINT "delivery_points_active_validated_check" CHECK (not "delivery_points"."active" or ("delivery_points"."validation_reference" is not null and "delivery_points"."validated_by" is not null and "delivery_points"."validated_at" is not null));--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_validation_reference_check" CHECK ("delivery_slots"."validation_reference" is null or length("delivery_slots"."validation_reference") between 10 and 500);--> statement-breakpoint
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_active_validated_check" CHECK (not "delivery_slots"."active" or ("delivery_slots"."validation_reference" is not null and "delivery_slots"."validated_by" is not null and "delivery_slots"."validated_at" is not null));--> statement-breakpoint
CREATE FUNCTION public.guard_catalog_point()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_role user_role;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.active AND (NEW.name, NEW.address, NEW.municipality, NEW.time_zone, NEW.appointment_required)
      IS DISTINCT FROM (OLD.name, OLD.address, OLD.municipality, OLD.time_zone, OLD.appointment_required) THEN
      RAISE EXCEPTION 'deactivate and revalidate the center before changing its public details' USING ERRCODE = '23514';
    END IF;
    IF OLD.active AND NOT NEW.active AND EXISTS (
      SELECT 1 FROM deliveries WHERE delivery_point_id = OLD.id AND status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'center has outstanding reservations' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.active AND (NEW.name, NEW.address, NEW.municipality, NEW.time_zone, NEW.appointment_required)
      IS DISTINCT FROM (OLD.name, OLD.address, OLD.municipality, OLD.time_zone, OLD.appointment_required) THEN
      NEW.validation_reference := NULL;
      NEW.validated_by := NULL;
      NEW.validated_at := NULL;
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.active THEN
    SELECT role INTO actor_role FROM users WHERE clerk_user_id = NEW.validated_by;
    IF actor_role IS DISTINCT FROM 'admin'::user_role THEN
      RAISE EXCEPTION 'center validator must be an administrator' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER delivery_points_validation_guard
BEFORE INSERT OR UPDATE ON public.delivery_points
FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_point();--> statement-breakpoint
CREATE FUNCTION public.guard_catalog_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  point_active boolean;
  appointment_required boolean;
  actor_role user_role;
  reserved_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.delivery_point_id::text, 0));
  SELECT active, delivery_points.appointment_required INTO point_active, appointment_required
    FROM delivery_points WHERE id = NEW.delivery_point_id FOR SHARE;
  IF NOT FOUND OR NOT appointment_required THEN
    RAISE EXCEPTION 'point does not accept appointment slots' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM delivery_slots s
    WHERE s.delivery_point_id = NEW.delivery_point_id AND s.id <> NEW.id
      AND s.starts_at < NEW.ends_at AND s.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'slot overlaps an existing slot' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT count(*)::integer INTO reserved_count FROM deliveries
      WHERE slot_id = OLD.id AND status NOT IN ('cancelled', 'rejected');
    IF reserved_count > 0 AND (NEW.delivery_point_id, NEW.starts_at, NEW.ends_at)
      IS DISTINCT FROM (OLD.delivery_point_id, OLD.starts_at, OLD.ends_at) THEN
      RAISE EXCEPTION 'reserved slot window is immutable' USING ERRCODE = '23514';
    END IF;
    IF reserved_count > NEW.capacity THEN
      RAISE EXCEPTION 'capacity cannot fall below reservations' USING ERRCODE = '23514';
    END IF;
    IF OLD.active AND NOT NEW.active AND reserved_count > 0 THEN
      RAISE EXCEPTION 'slot has outstanding reservations' USING ERRCODE = '23514';
    END IF;
    IF NOT NEW.active AND (NEW.delivery_point_id, NEW.starts_at, NEW.ends_at, NEW.capacity)
      IS DISTINCT FROM (OLD.delivery_point_id, OLD.starts_at, OLD.ends_at, OLD.capacity) THEN
      NEW.validation_reference := NULL;
      NEW.validated_by := NULL;
      NEW.validated_at := NULL;
    END IF;
  END IF;
  IF NEW.active THEN
    IF NOT point_active OR NEW.starts_at <= now() THEN
      RAISE EXCEPTION 'slot requires an active center and a future window' USING ERRCODE = '23514';
    END IF;
    SELECT role INTO actor_role FROM users WHERE clerk_user_id = NEW.validated_by;
    IF actor_role IS DISTINCT FROM 'admin'::user_role THEN
      RAISE EXCEPTION 'slot validator must be an administrator' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER delivery_slots_validation_guard
BEFORE INSERT OR UPDATE ON public.delivery_slots
FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_slot();--> statement-breakpoint
GRANT UPDATE (name, address, municipality, time_zone, appointment_required)
ON public.delivery_points TO ecopulse_app;--> statement-breakpoint
GRANT UPDATE (starts_at, ends_at, capacity)
ON public.delivery_slots TO ecopulse_app;