import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import pg from "pg";
import {seedChallenges} from "../../artifacts/api-server/src/lib/challenges.ts";

const apply=process.argv.includes("--apply");
if(!apply&&!process.argv.includes("--dry-run"))throw Error("explicit_migration_mode_required");
const proof=JSON.parse(await readFile(new URL("../qa/evidence/challenges-isolated-2026-11-07.json",import.meta.url),"utf8"));
if(proof.status!=="PASS"||proof.restoredTablesMatched<27||proof.challengeChecks?.awardCount!==200||proof.challengeLoad?.durationSeconds<300||proof.challengeLoad?.errors!==0)throw Error("restored_backup_and_five_minute_integration_required");
const archive=await readFile(process.env.ECOPULSE_VERIFIED_BACKUP||"");
if(createHash("sha256").update(archive).digest("hex")!==proof.backupSha256)throw Error("verified_backup_mismatch");
const url=new URL(process.env.NEON_DATABASE_URL||"");
if(!url.hostname.endsWith(".neon.tech")||url.pathname!=="/neondb")throw Error("existing_neon_required");
url.searchParams.set("sslmode","verify-full");
const client=new pg.Client({connectionString:url.href,connectionTimeoutMillis:15000});let stage="connect";
const report={check:"challenge_migration",applied:apply,restoredBackupVerified:true,participantsCreated:0,attemptsCreated:0,pointsGranted:0,rewardsChanged:0};
try{
  await client.connect();await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='30s'");await client.query("SELECT pg_advisory_xact_lock(741926245)");
  stage="schema";
  const present=(await client.query("SELECT to_regclass('public.eco_challenges') IS NOT NULL AS ready")).rows[0].ready;
  if(!present){
    await client.query(await readFile(new URL("../../lib/db/drizzle/0007_ecological_challenges.sql",import.meta.url),"utf8"));
  }
  stage="catalog";await seedChallenges(client);
  stage="verify";
  const tables=(await client.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='public'::regnamespace AND obj_description(oid,'pg_class')='ecopulse:challenges:v1'")).rows[0].n;
  if(tables!==5)throw Error("challenge_schema_requires_review");
  const privileges=(await client.query(`SELECT has_table_privilege('ecopulse_app','eco_challenge_awards','SELECT,INSERT') AS rw,
    has_table_privilege('ecopulse_app','eco_challenge_awards','UPDATE,DELETE,TRUNCATE') AS mutable,
    (SELECT count(*) FROM eco_challenges WHERE slug IN ('separar-con-criterio','papel-sin-contaminar','plasticos-con-destino','vidrio-con-cuidado','metales-en-circulo','organicos-con-proposito','residuos-especiales','reusar-antes-de-comprar','agua-y-separacion','comunidad-responsable'))::int AS catalog`)).rows[0];
  if(!privileges.rw||privileges.mutable||privileges.catalog!==10)throw Error("challenge_permissions_or_catalog_invalid");
  await client.query(apply?"COMMIT":"ROLLBACK");report.status="PASS";report.catalogDefinitions=10;
}catch(error){await client.query("ROLLBACK").catch(()=>{});report.status="FAIL";report.stage=stage;if(/^[A-Z0-9]{5}$/.test(error.code||""))report.sqlState=error.code;process.exitCode=1;}
finally{await client.end().catch(()=>{});console.log(JSON.stringify(report));if(apply&&report.status==="PASS")await writeFile(new URL("../qa/evidence/challenges-migration-2026-11-07.json",import.meta.url),JSON.stringify(report,null,2));}
