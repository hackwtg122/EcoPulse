import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parseStoredQuestion,
  GuideStorageError,
  listGuideConversations,
} from "./guideStorage.ts";

test("stored questions accept only a bounded question, never client history or identity", () => {
  assert.equal(
    parseStoredQuestion({ question: "  ¿Cómo separo el vidrio?  " }),
    "¿Cómo separo el vidrio?",
  );
  for (const body of [
    null,
    {},
    { question: "" },
    { question: "a".repeat(501) },
    { question: "Vidrio", userId: "not_an_identity" },
    { question: "Vidrio", history: [] },
  ])
    assert.throws(() => parseStoredQuestion(body));
});
test("obvious credentials and private keys cannot be stored as questions", () => {
  for (const question of [
    "-----BEGIN PRIVATE KEY-----",
    `Bearer ${"a".repeat(30)}`,
    `sk-${"a".repeat(30)}`,
  ])
    assert.throws(
      () => parseStoredQuestion({ question }),
      (error) =>
        error instanceof GuideStorageError &&
        error.code === "sensitive_guide_content",
    );
});
test("invalid principals are rejected before opening any database connection", async () => {
  await assert.rejects(
    listGuideConversations(null, ""),
    (error) => error instanceof GuideStorageError && error.status === 401,
  );
});
test("migration is additive and constrains ownership, consent, duplicate turns and RLS", () => {
  const sql = readFileSync(
    new URL(
      "../../../../scripts/neon/ecoguide-persistence-migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\s/gim);
  assert.match(sql, /FOREIGN KEY \(conversation_id,user_id\)/);
  assert.match(sql, /UNIQUE \(conversation_id,request_key\)/);
  assert.match(sql, /storage_consented_at timestamptz NOT NULL/);
  assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g) || []).length, 2);
  assert.equal(
    (sql.match(/WITH CHECK \(user_id=current_setting/g) || []).length,
    2,
  );
  assert.match(sql, /WHERE status='pending'/);
  assert.doesNotMatch(sql, /TO PUBLIC|SECURITY DEFINER/);
});
