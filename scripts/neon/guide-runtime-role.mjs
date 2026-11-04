import { randomBytes, pbkdf2Sync, createHmac, createHash } from "node:crypto";

export const guideRuntimeRole = "ecopulse_guide_runtime";

// Caller owns the transaction. No existing role/password is ever changed.
export async function createGuideRuntimeRole(client) {
  const present = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname=$1",
    [guideRuntimeRole],
  );
  if (present.rowCount) throw new Error("existing_guide_role_requires_review");
  const schema =
    await client.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('guide_conversations','guide_turns') AND c.relrowsecurity AND c.relforcerowsecurity
    AND obj_description(c.oid,'pg_class')='ecopulse:ecoguide-persistence:v1'`);
  if (schema.rows[0].count !== 2) throw new Error("guide_schema_missing");
  const password = randomBytes(32).toString("hex");
  // Send a SCRAM verifier, not the clear-text generated secret, in role DDL.
  const salt = randomBytes(16),
    iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", salted)
    .update("Server Key")
    .digest("base64");
  const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
  await client.query(
    `CREATE ROLE ecopulse_guide_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '${verifier}'`,
  );
  await client.query(
    "GRANT CONNECT ON DATABASE neondb TO ecopulse_guide_runtime",
  );
  await client.query("GRANT USAGE ON SCHEMA public TO ecopulse_guide_runtime");
  await client.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE ON public.guide_conversations,public.guide_turns TO ecopulse_guide_runtime",
  );
  const excessive = await client.query(
    "SELECT has_table_privilege($1,'public.users','SELECT') OR has_schema_privilege($1,'public','CREATE') AS present",
    [guideRuntimeRole],
  );
  if (excessive.rows[0].present)
    throw new Error("guide_runtime_excessive_public_privileges");
  return { role: guideRuntimeRole, password };
}
