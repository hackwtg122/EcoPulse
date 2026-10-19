import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("bootstrap references each official migration once, in order", () => {
  const entry = "scripts/eval/db/drizzle/0000_eval_init.sql";
  const sql = read(entry);
  const includes = [...sql.matchAll(/^\\ir (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(includes.map(path => path.split("/").at(-1)), [
    "0000_core.sql", "0001_delivery_details.sql",
    "0002_catalog_validation.sql", "0003_reward_fulfillment.sql",
  ]);
  for (const path of includes) assert.ok(existsSync(resolve(root, dirname(entry), path)));
  assert.match(sql, /current_database\(\) <> 'ecopulse_eval'/);
});

test("seed, grants and rollback are isolated and preserve transactional history", () => {
  const seed = read("scripts/eval/db/eval-seed.sql");
  const materials = read("scripts/eval/db/academic-materials.sql");
  const favorites = read("scripts/eval/db/academic-favorites.sql");
  const grants = read("scripts/eval/db/eval-grants.sql");
  const rollback = read("scripts/eval/db/eval-rollback.sql");
  for (const sql of [materials, favorites, seed, grants, rollback]) {
    assert.match(sql, /current_database\(\) <> 'ecopulse_eval'/);
    assert.match(sql, /BEGIN;/);
    assert.match(sql, /COMMIT;/);
    assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
  }
  assert.equal((seed.match(/'eval-0[1-8]'/g) ?? []).length >= 8, true);
  assert.match(seed, /INSERT INTO delivery_point_materials/);
  assert.match(seed, /ON CONFLICT \(delivery_point_id, starts_at, ends_at\) DO NOTHING/);
  assert.doesNotMatch(grants, /GRANT ALL|GRANT\s+\w+\s+ON ALL TABLES|ALTER DEFAULT PRIVILEGES/i);
});
