import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function verifyRewardDraftRecovery(client) {
  const { rows: [state] } = await client.query(`SELECT obj_description('public.reward_draft_recoveries'::regclass,'pg_class') AS marker,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.reward_draft_recoveries'::regclass AND tgname='reward_draft_recoveries_immutable' AND tgenabled='O') AS immutable,
    has_table_privilege('ecopulse_app','public.reward_draft_recoveries','SELECT') AND has_table_privilege('ecopulse_app','public.reward_draft_recoveries','INSERT') AS allowed,
    has_table_privilege('ecopulse_app','public.reward_draft_recoveries','UPDATE,DELETE,TRUNCATE') AS mutable,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.reward_draft_recoveries'::regclass AND contype='u' AND convalidated AND pg_get_constraintdef(oid)='UNIQUE (administrator_id, idempotency_key)') AS idempotent`);
  assert.equal(state.marker, "ecopulse:reward-draft-recovery:v1");
  assert.equal(state.immutable, true); assert.equal(state.allowed, true); assert.equal(state.mutable, false); assert.equal(state.idempotent, true);
  const source = await readFile(new URL("../../artifacts/api-server/src/lib/rewardService.ts", import.meta.url), "utf8");
  const segment = source.slice(source.indexOf("export async function recoverRewardDraft"), source.indexOf("export function parseRewardRestock"));
  const queries = [...segment.matchAll(/`[^`]+`|"(?:[^"\\]|\\.)*"/g)].map(match => match[0].startsWith('"') ? JSON.parse(match[0]) : match[0].slice(1, -1)).filter(value => /^(SELECT|INSERT|UPDATE|DELETE)\b/.test(value));
  assert.equal(queries.length, 8);
  for (const [index, sql] of queries.entries()) {
    await client.query(`PREPARE reward_recovery_${index} AS ${sql}`); await client.query(`DEALLOCATE reward_recovery_${index}`);
  }
  return { recoverySchemaVerified: true, recoveryQueriesPrepared: queries.length, rewardsChanged: 0 };
}
