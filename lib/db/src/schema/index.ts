import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["participant", "verifier", "admin"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "approved", "rejected"]);
export const deliveryRequestStatus = pgEnum("delivery_request_status", ["pending", "scheduled", "received", "approved", "rejected", "cancelled"]);
export const movementKind = pgEnum("movement_kind", ["delivery", "redemption", "adjustment"]);

// Clerk retains identity data; this database stores only its stable user ID and app role.
export const users = pgTable("users", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  role: userRole("role").notNull().default("participant"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Guidance only: no image, location, or points are retained with a scan.
export const scans = pgTable("scans", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  category: text("category").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("scans_category_length_check", sql`length(${table.category}) between 1 and 64`),
  check("scans_source_check", sql`${table.source} in ('manual', 'demo')`),
  index("scans_user_created_idx").on(table.userId, table.createdAt.desc()),
]);

// Stable material codes shared by scans, delivery estimates, and future physical verification.
export const materialCategories = pgTable("material_categories", {
  code: text("code").primaryKey(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("material_categories_code_check", sql`${table.code} in ('paper', 'plastic', 'glass', 'metal', 'organic', 'other')`),
]);

// Rows are created only after an organization has validated the public point data.
export const deliveryPoints = pgTable("delivery_points", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  municipality: text("municipality").notNull(),
  timeZone: text("time_zone").notNull(),
  appointmentRequired: boolean("appointment_required").notNull().default(true),
  active: boolean("active").notNull().default(false),
  validationReference: text("validation_reference"),
  validatedBy: text("validated_by").references(() => users.clerkUserId),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("delivery_points_code_length_check", sql`length(${table.code}) between 3 and 64`),
  check("delivery_points_name_length_check", sql`length(${table.name}) between 1 and 160`),
  check("delivery_points_address_length_check", sql`length(${table.address}) between 1 and 240`),
  check("delivery_points_municipality_length_check", sql`length(${table.municipality}) between 1 and 120`),
  check("delivery_points_timezone_length_check", sql`length(${table.timeZone}) between 1 and 64`),
  check("delivery_points_validation_reference_check", sql`${table.validationReference} is null or length(${table.validationReference}) between 10 and 500`),
  check("delivery_points_active_validated_check", sql`not ${table.active} or (${table.validationReference} is not null and ${table.validatedBy} is not null and ${table.validatedAt} is not null)`),
  uniqueIndex("delivery_points_code_unique").on(table.code),
  index("delivery_points_active_name_idx").on(table.active, table.name),
]);

// Availability is explicit. Empty tables mean that no scheduling is offered.
export const deliverySlots = pgTable("delivery_slots", {
  id: uuid("id").primaryKey(),
  deliveryPointId: uuid("delivery_point_id").notNull().references(() => deliveryPoints.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  capacity: integer("capacity").notNull(),
  active: boolean("active").notNull().default(false),
  validationReference: text("validation_reference"),
  validatedBy: text("validated_by").references(() => users.clerkUserId),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("delivery_slots_time_check", sql`${table.endsAt} > ${table.startsAt}`),
  check("delivery_slots_duration_check", sql`${table.endsAt} <= ${table.startsAt} + interval '8 hours'`),
  check("delivery_slots_capacity_check", sql`${table.capacity} between 1 and 1000`),
  check("delivery_slots_validation_reference_check", sql`${table.validationReference} is null or length(${table.validationReference}) between 10 and 500`),
  check("delivery_slots_active_validated_check", sql`not ${table.active} or (${table.validationReference} is not null and ${table.validatedBy} is not null and ${table.validatedAt} is not null)`),
  uniqueIndex("delivery_slots_point_window_unique").on(table.deliveryPointId, table.startsAt, table.endsAt),
  uniqueIndex("delivery_slots_id_point_unique").on(table.id, table.deliveryPointId),
  index("delivery_slots_point_start_idx").on(table.deliveryPointId, table.startsAt),
]);

export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  status: deliveryRequestStatus("status").notNull().default("pending"),
  requestVersion: smallint("request_version").notNull().default(2),
  deliveryPointId: uuid("delivery_point_id").references(() => deliveryPoints.id),
  slotId: uuid("slot_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("deliveries_request_version_check", sql`${table.requestVersion} in (1, 2)`),
  check("deliveries_version_details_check", sql`
    (${table.requestVersion} = 1 and ${table.deliveryPointId} is null and ${table.slotId} is null)
    or (${table.requestVersion} = 2 and ${table.deliveryPointId} is not null)
  `),
  check("deliveries_scheduled_slot_check", sql`${table.status} <> 'scheduled' or ${table.slotId} is not null`),
  foreignKey({
    columns: [table.slotId, table.deliveryPointId],
    foreignColumns: [deliverySlots.id, deliverySlots.deliveryPointId],
    name: "deliveries_slot_point_fk",
  }),
  index("deliveries_user_created_idx").on(table.userId, table.createdAt.desc()),
  index("deliveries_status_created_idx").on(table.status, table.createdAt.desc(), table.id.desc()),
  index("deliveries_slot_status_idx").on(table.slotId, table.status),
]);

// Estimated grams express user intent only and never authorize points.
export const deliveryItems = pgTable("delivery_items", {
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
  categoryCode: text("category_code").notNull().references(() => materialCategories.code),
  estimatedGrams: integer("estimated_grams").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.deliveryId, table.categoryCode], name: "delivery_items_pk" }),
  check("delivery_items_estimated_grams_check", sql`${table.estimatedGrams} between 1 and 100000`),
  index("delivery_items_category_idx").on(table.categoryCode),
]);

// Append-only event history. The current status remains on deliveries for efficient reads.
export const deliveryStatusEvents = pgTable("delivery_status_events", {
  id: uuid("id").primaryKey(),
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
  actorUserId: text("actor_user_id").references(() => users.clerkUserId),
  fromStatus: deliveryRequestStatus("from_status"),
  toStatus: deliveryRequestStatus("to_status").notNull(),
  reasonCode: text("reason_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("delivery_status_events_transition_check", sql`${table.fromStatus} is null or ${table.fromStatus} <> ${table.toStatus}`),
  check("delivery_status_events_reason_length_check", sql`${table.reasonCode} is null or length(${table.reasonCode}) between 1 and 64`),
  index("delivery_status_events_delivery_created_idx").on(table.deliveryId, table.createdAt, table.id),
]);

// Store hashes rather than raw client keys. request_hash detects changed payloads on replay.
export const deliveryIdempotency = pgTable("delivery_idempotency", {
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  operation: text("operation").notNull(),
  keyHash: text("key_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  deliveryId: uuid("delivery_id").references(() => deliveries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.operation, table.keyHash], name: "delivery_idempotency_pk" }),
  check("delivery_idempotency_operation_check", sql`${table.operation} in ('create', 'complete_details', 'cancel', 'reserve')`),
  check("delivery_idempotency_key_hash_check", sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`),
  check("delivery_idempotency_request_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("delivery_idempotency_completion_check", sql`
    (${table.completedAt} is null and ${table.deliveryId} is null)
    or (${table.completedAt} is not null and ${table.deliveryId} is not null)
  `),
  index("delivery_idempotency_delivery_idx").on(table.deliveryId),
]);

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey(),
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
  verifierId: text("verifier_id").notNull().references(() => users.clerkUserId),
  decision: deliveryStatus("decision").notNull(),
  verifiedGrams: integer("verified_grams"),
  receiptCode: text("receipt_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("verifications_decision_check", sql`${table.decision} in ('approved', 'rejected')`),
  check("verifications_weight_check", sql`
    (${table.decision} = 'approved' and ${table.verifiedGrams} between 1 and 100000 and length(${table.receiptCode}) between 8 and 64)
    or (${table.decision} = 'rejected' and ${table.verifiedGrams} is null and ${table.receiptCode} is null)
  `),
  uniqueIndex("verifications_delivery_unique").on(table.deliveryId),
  uniqueIndex("verifications_receipt_unique").on(table.receiptCode),
]);

export const pointMovements = pgTable("point_movements", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  delta: integer("delta").notNull(),
  kind: movementKind("kind").notNull(),
  sourceId: uuid("source_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("point_movements_delta_check", sql`${table.delta} <> 0`),
  check("point_movements_direction_check", sql`
    (${table.kind} = 'delivery' and ${table.delta} > 0)
    or (${table.kind} = 'redemption' and ${table.delta} < 0)
    or ${table.kind} = 'adjustment'
  `),
  uniqueIndex("point_movements_source_unique").on(table.kind, table.sourceId),
  index("point_movements_user_created_idx").on(table.userId, table.createdAt.desc()),
]);

// Keep empty until partners and fulfillment capacity have been verified.
export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  cost: integer("cost").notNull(),
  active: boolean("active").notNull().default(false),
  inventoryRemaining: integer("inventory_remaining"),
  fulfillmentReference: text("fulfillment_reference"),
  validatedBy: text("validated_by").references(() => users.clerkUserId),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("rewards_inventory_check", sql`${table.inventoryRemaining} is null or ${table.inventoryRemaining} between 0 and 100000`),
  check("rewards_fulfillment_reference_check", sql`${table.fulfillmentReference} is null or length(${table.fulfillmentReference}) between 10 and 500`),
  check("rewards_active_validated_check", sql`not ${table.active} or (${table.inventoryRemaining} > 0 and ${table.fulfillmentReference} is not null and ${table.validatedBy} is not null and ${table.validatedAt} is not null)`),
  check("rewards_title_length_check", sql`length(${table.title}) between 1 and 120`),
  check("rewards_description_length_check", sql`length(${table.description}) <= 500`),
  check("rewards_cost_check", sql`${table.cost} > 0`),
]);

export const redemptions = pgTable("redemptions", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  rewardId: uuid("reward_id").notNull().references(() => rewards.id),
  cost: integer("cost").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  fulfillmentStatus: text("fulfillment_status").notNull().default("reserved"),
  fulfillmentReference: text("fulfillment_reference"),
  fulfilledBy: text("fulfilled_by").references(() => users.clerkUserId),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("redemptions_fulfillment_reference_check", sql`${table.fulfillmentReference} is null or length(${table.fulfillmentReference}) between 10 and 120`),
  check("redemptions_fulfillment_check", sql`(${table.fulfillmentStatus} = 'reserved' and ${table.fulfillmentReference} is null and ${table.fulfilledBy} is null and ${table.fulfilledAt} is null) or (${table.fulfillmentStatus} = 'fulfilled' and ${table.fulfillmentReference} is not null and ${table.fulfilledBy} is not null and ${table.fulfilledAt} is not null)`),
  check("redemptions_cost_check", sql`${table.cost} > 0`),
  check("redemptions_idempotency_length_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
  uniqueIndex("redemptions_idempotency_unique").on(table.userId, table.idempotencyKey),
  index("redemptions_user_created_idx").on(table.userId, table.createdAt.desc()),
]);
