import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["participant", "verifier", "admin"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "approved", "rejected"]);
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
});

export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  status: deliveryStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey(),
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
  verifierId: text("verifier_id").notNull().references(() => users.clerkUserId),
  decision: deliveryStatus("decision").notNull(),
  verifiedGrams: integer("verified_grams"),
  receiptCode: text("receipt_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
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
}, (table) => [uniqueIndex("point_movements_source_unique").on(table.kind, table.sourceId)]);

// Keep empty until partners and fulfillment capacity have been verified.
export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  cost: integer("cost").notNull(),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const redemptions = pgTable("redemptions", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.clerkUserId),
  rewardId: uuid("reward_id").notNull().references(() => rewards.id),
  cost: integer("cost").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("redemptions_idempotency_unique").on(table.userId, table.idempotencyKey)]);
