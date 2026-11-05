import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Schema and PREPARE only: never executes a stock adjustment or business write.
export async function verifyRewardInventory(client) {
  const { rows: [table] } = await client.query(`SELECT obj_description(c.oid,'pg_class') AS marker,
    (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='reward_inventory_immutable' AND t.tgenabled='O') AS immutable,
    (SELECT count(*)::int FROM pg_constraint x WHERE x.conrelid=c.oid AND NOT x.convalidated) AS unvalidated,
    (SELECT count(*)::int FROM pg_constraint x WHERE x.conrelid=c.oid AND x.contype='u' AND pg_get_constraintdef(x.oid)='UNIQUE (administrator_id, idempotency_key)') AS idempotency
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='reward_inventory_movements'`);
  assert.equal(table?.marker, "ecopulse:reward-inventory:v1");
  assert.equal(table.immutable, 1); assert.equal(table.unvalidated, 0); assert.equal(table.idempotency, 1);
  const { rows: [rights] } = await client.query(`SELECT
    has_table_privilege('ecopulse_app','public.reward_inventory_movements','SELECT') AND has_table_privilege('ecopulse_app','public.reward_inventory_movements','INSERT') AS allowed,
    has_table_privilege('ecopulse_app','public.reward_inventory_movements','UPDATE,DELETE,TRUNCATE') AS mutable,
    (SELECT count(*)::int FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='reward_inventory_movements' AND grantee='PUBLIC') AS public_grants`);
  assert.equal(rights.allowed, true); assert.equal(rights.mutable, false); assert.equal(rights.public_grants, 0);
  const source = await readFile(new URL("../../artifacts/api-server/src/lib/rewardService.ts", import.meta.url), "utf8");
  const restock = source.slice(source.indexOf("export async function restockReward"), source.indexOf("// Audit references"));
  const queries = [...restock.matchAll(/(?:client|pool)\.query(?:<[^>]+>)?\(\s*(`[^`]+`|"(?:[^"\\]|\\.)*")/g)].map(match => match[1].startsWith('"') ? JSON.parse(match[1]) : match[1].slice(1, -1));
  assert.ok(queries.length >= 7);
  for (const [index, sql] of queries.entries()) {
    assert.ok(!sql.includes("${"));
    await client.query(`PREPARE inventory_schema_${index} AS ${sql}`);
    await client.query(`DEALLOCATE inventory_schema_${index}`);
  }
  return { preparedQueries: queries.length, immutableLedger: true, idempotencyConstraint: true, operationalRecordsCreated: 0 };
}
