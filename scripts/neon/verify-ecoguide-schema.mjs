import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import ts from "typescript";

// Read-only production schema checks and PREPARE (never EXECUTE) of the actual
// service SQL. This checks PostgreSQL compatibility without fabricated users,
// questions, answers or operations, and is NOT authenticated application QA.
const url = new URL(process.env.NEON_DATABASE_URL || "");
assert.ok(url.hostname.endsWith(".neon.tech") && url.pathname === "/neondb");
url.searchParams.set("sslmode", "verify-full");
const client = new pg.Client({
  connectionString: url.href,
  connectionTimeoutMillis: 15000,
});
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout='15s'");
  const tables =
    await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('guide_conversations','guide_turns')`);
  assert.equal(tables.rowCount, 2);
  for (const row of tables.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.policies, 1);
  }
  const publicGrants = await client.query(
    "SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('guide_conversations','guide_turns') AND grantee='PUBLIC'",
  );
  assert.equal(publicGrants.rows[0].count, 0);
  const source = await readFile(
    new URL(
      "../../artifacts/api-server/src/lib/guideStorage.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "guideStorage.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const queries = new Set();
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "query"
    ) {
      const argument = node.arguments[0];
      if (
        argument &&
        (ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument)) &&
        /^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(argument.text.trim())
      )
        queries.add(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(queries.size >= 15);
  let index = 0;
  for (const sql of queries) {
    await client.query(`PREPARE ecoguide_schema_${index} AS ${sql}`);
    await client.query(`DEALLOCATE ecoguide_schema_${index++}`);
  }
  await client.query("ROLLBACK");
  console.log(
    JSON.stringify({
      check: "ecoguide_production_schema",
      status: "PASS",
      rlsTables: 2,
      publicGrants: 0,
      preparedServiceQueries: index,
      serviceQueriesExecuted: 0,
      scope: "schema_and_sql_not_Clerk_session",
    }),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(
    JSON.stringify({
      check: "ecoguide_production_schema",
      status: "FAIL",
      code: /^[A-Z0-9]{5}$/.test(error.code || "")
        ? error.code
        : "schema_validation_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
