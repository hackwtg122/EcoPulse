import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const drizzleDirectory = fileURLToPath(new URL("../lib/db/drizzle/", import.meta.url));
const journalFile = fileURLToPath(new URL("../lib/db/drizzle/meta/_journal.json", import.meta.url));
const initialSnapshotFile = fileURLToPath(new URL("../lib/db/drizzle/meta/0000_snapshot.json", import.meta.url));
const detailsSnapshotFile = fileURLToPath(new URL("../lib/db/drizzle/meta/0001_snapshot.json", import.meta.url));
const initialMigrationFile = fileURLToPath(new URL("../lib/db/drizzle/0000_core.sql", import.meta.url));
const detailsMigrationFile = fileURLToPath(new URL("../lib/db/drizzle/0001_delivery_details.sql", import.meta.url));

const initialSql = readFileSync(initialMigrationFile, "utf8");
const detailsSql = readFileSync(detailsMigrationFile, "utf8");
const journal = JSON.parse(readFileSync(journalFile, "utf8"));
const initialSnapshot = JSON.parse(readFileSync(initialSnapshotFile, "utf8"));
const detailsSnapshot = JSON.parse(readFileSync(detailsSnapshotFile, "utf8"));
const sqlFiles = readdirSync(drizzleDirectory).filter((name) => name.endsWith(".sql")).sort();

const coreTables = ["users", "scans", "deliveries", "verifications", "point_movements", "rewards", "redemptions"];
const detailTables = [
  "material_categories",
  "delivery_items",
  "delivery_points",
  "delivery_slots",
  "delivery_status_events",
  "delivery_idempotency",
];
const initialFragments = [
  ...coreTables.map((table) => `CREATE TABLE "${table}"`),
  "point_movements_append_only",
  "reject_point_movement_mutation",
  "point_movements_direction_check",
  "verifications_weight_check",
  "redemptions_idempotency_unique",
];
const detailsFragments = [
  ...detailTables.map((table) => `CREATE TABLE "${table}"`),
  'UPDATE "deliveries" SET "request_version" = 1',
  "delivery_idempotency_request_hash_check",
  "deliveries_slot_point_fk",
  "deliveries_destination_guard",
  "delivery_items_limits_guard",
  "deliveries_require_initial_status_event",
  "delivery_status_events_append_only",
];

if (JSON.stringify(sqlFiles) !== JSON.stringify(journal.entries.map(entry => `${entry.tag}.sql`))) {
  throw new Error("SQL migrations must match the complete canonical journal");
}
if (
  journal.version !== "7" ||
  journal.dialect !== "postgresql" ||
  journal.entries.length < 2 ||
  journal.entries.some((entry,index) => entry.idx !== index || !entry.tag.startsWith(`${String(index).padStart(4,"0")}_`)) ||
  journal.entries[0].tag !== "0000_core" ||
  journal.entries[1].tag !== "0001_delivery_details"
) {
  throw new Error("Drizzle migration journal is inconsistent");
}
if (Object.keys(initialSnapshot.tables).length !== coreTables.length) {
  throw new Error("The 0000 snapshot must contain exactly seven application tables");
}
if (Object.keys(detailsSnapshot.tables).length !== coreTables.length + detailTables.length) {
  throw new Error("The 0001 snapshot must contain exactly thirteen application tables");
}
if (detailsSnapshot.prevId !== initialSnapshot.id) {
  throw new Error("The 0001 snapshot is not based directly on 0000");
}
let previousSnapshot = initialSnapshot;
for (let index=1;index<journal.entries.length;index++) {
  const snapshot=JSON.parse(readFileSync(new URL(`../lib/db/drizzle/meta/${String(index).padStart(4,"0")}_snapshot.json`,import.meta.url),"utf8"));
  if(snapshot.prevId !== previousSnapshot.id) throw new Error(`Snapshot ${index} is not linked to its predecessor`);
  previousSnapshot=snapshot;
}
for (const fragment of initialFragments) {
  if (!initialSql.includes(fragment)) throw new Error(`Initial migration is missing: ${fragment}`);
}
for (const fragment of detailsFragments) {
  if (!detailsSql.includes(fragment)) throw new Error(`Delivery details migration is missing: ${fragment}`);
}
for (const name of sqlFiles) {
  const sql = readFileSync(new URL(`../lib/db/drizzle/${name}`,import.meta.url),"utf8");
  if (/^\s*(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\s|DELETE\s+FROM\s)/gim.test(sql)) {
    throw new Error(`${name} contains an unexpected destructive statement`);
  }
}
if ((detailsSql.match(/SECURITY DEFINER/g) ?? []).length !== 2 ||
    (detailsSql.match(/SET search_path = pg_catalog, public/g) ?? []).length !== 2) {
  throw new Error("Only the two row-locking trigger functions must use a fixed security-definer context");
}
if (/^\s*(GRANT|REVOKE)\s/gim.test(detailsSql)) {
  throw new Error("Runtime permissions must remain separate from 0001");
}if (/INSERT\s+INTO\s+"delivery_points"|INSERT\s+INTO\s+"delivery_slots"/i.test(detailsSql)) {
  throw new Error("0001 must not invent delivery points or schedules");
}

console.log(JSON.stringify({
  canonicalMigrations: sqlFiles,
  journalEntries: journal.entries.length,
  snapshotTables: { core: coreTables.length, deliveryDetails: coreTables.length + detailTables.length, latest: Object.keys(previousSnapshot.tables).length },
  addedTables: detailTables,
  destructiveStatements: false,
  realDeliveryPointsSeeded: 0,
  realSlotsSeeded: 0,
  customIntegrityTriggersPresent: true,
  fixedSecurityDefinerFunctions: 2,
  deliveryDetailsRuntimePermissionsEmbedded: false,
}, null, 2));
