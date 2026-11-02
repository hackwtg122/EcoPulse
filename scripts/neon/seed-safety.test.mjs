import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const seed = readFileSync(new URL("./neon-seed.sql", import.meta.url), "utf8");
const sql = seed.replace(/^\s*--.*$/gm, "");
test("academic seed cannot bootstrap roles, publish fixtures or overwrite existing data", () => {
  assert.doesNotMatch(sql, /user_[A-Za-z0-9]+|INSERT\s+INTO\s+(?:public\.)?users\b/i);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|TRUNCATE|DROP|GRANT)\b/i);
  assert.doesNotMatch(sql, /true\s*,\s*true/);
  assert.match(sql, /capacity, active\)[\s\S]*?20, false/);
  assert.ok(sql.indexOf("\\if :{?authorize_academic_seed}") < sql.indexOf("BEGIN;"));
  assert.match(sql, /p\.id<>fixture\.id OR p\.code<>fixture\.code/);
});
test("seed windows have an explicit stable anchor and are filtered before overlap triggers", () => {
  assert.match(sql, /current_setting\('ecopulse.seed_week'\)::date/);
  assert.doesNotMatch(sql, /date_trunc\('week',\s*now\(/);
  assert.ok(sql.indexOf("SELECT pg_advisory_xact_lock") < sql.indexOf("WITH windows AS"));
  const insert = sql.slice(sql.indexOf("INSERT INTO public.delivery_slots"));
  assert.ok(insert.indexOf("WHERE NOT EXISTS") < insert.indexOf("ON CONFLICT"));
  assert.match(insert, /s\.starts_at < w\.starts_at \+ interval '2 hours' AND s\.ends_at > w\.starts_at/);
});
