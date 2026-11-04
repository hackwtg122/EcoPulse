import { randomBytes } from "node:crypto";

export const guideRuntimeRole = "ecopulse_guide_runtime";

// Caller owns the transaction. No existing role/password is ever changed.
export async function createGuideRuntimeRole(
  client,
  existingGeneratedPassword,
) {
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
  if (
    existingGeneratedPassword !== undefined &&
    !/^[a-f0-9]{64}$/.test(existingGeneratedPassword)
  )
    throw new Error("guide_generated_secret_requires_review");
  const password = existingGeneratedPassword ?? randomBytes(32).toString("hex");
  // Neon's control plane rejects pre-hashed SCRAM verifiers, so the one-time
  // generated password is sent over the verified TLS connection. It is only
  // stored in the Render environment; this statement is never logged.
  await client.query(
    `CREATE ROLE ecopulse_guide_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '${password}'`,
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
