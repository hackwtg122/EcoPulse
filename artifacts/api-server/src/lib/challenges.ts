import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { validIdempotencyKey, uuidPattern } from "./pilotPolicy.ts";
import { lockCurrentAdministrator } from "./adminMutation.ts";
import { initialChallenges, type ChallengeDefinition, type ChallengeQuestion } from "./challengeCatalog.ts";

export class ChallengeError extends Error {
  readonly status:number;
  readonly code:string;
  constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
}
const object=(raw:unknown):Record<string,unknown>=>{
  if(!raw || typeof raw!=="object" || Array.isArray(raw)) throw new ChallengeError(400,"invalid_challenge_request");
  return raw as Record<string,unknown>;
};
const text=(raw:unknown,max:number)=>{
  if(typeof raw!=="string" || !raw.trim() || raw.length>max) throw new ChallengeError(400,"invalid_challenge_text");
  return raw.trim();
};
export function parseChallengeDefinition(raw:unknown):ChallengeDefinition {
  const row=object(raw);
  if(Object.keys(row).some(k=>!["slug","title","description","questions","points","passPercent","active"].includes(k))) throw new ChallengeError(400,"unexpected_fields");
  const slug=text(row.slug,80);
  if(!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug) || typeof row.active!=="boolean" || !Number.isInteger(row.points) || Number(row.points)<1 || Number(row.points)>1000 || !Number.isInteger(row.passPercent) || Number(row.passPercent)<50 || Number(row.passPercent)>100) throw new ChallengeError(400,"invalid_challenge_policy");
  if(!Array.isArray(row.questions) || row.questions.length<2 || row.questions.length>10) throw new ChallengeError(400,"invalid_challenge_questions");
  const questions=row.questions.map(raw=>{
    const q=object(raw);
    if(Object.keys(q).some(k=>!["prompt","options","correctIndex","explanation"].includes(k)) || !Array.isArray(q.options) || q.options.length<2 || q.options.length>5 || !Number.isInteger(q.correctIndex) || Number(q.correctIndex)<0 || Number(q.correctIndex)>=q.options.length) throw new ChallengeError(400,"invalid_challenge_question");
    const options=q.options.map(option=>text(option,300));
    if(new Set(options).size!==options.length) throw new ChallengeError(400,"duplicate_challenge_options");
    return {prompt:text(q.prompt,500),options,correctIndex:Number(q.correctIndex),explanation:text(q.explanation,1000)};
  });
  return {slug,title:text(row.title,120),description:text(row.description,500),questions,points:Number(row.points),passPercent:Number(row.passPercent),active:row.active};
}
export function parseChallengeAnswers(raw:unknown,questions:ChallengeQuestion[],partial=false):(number|null)[] {
  const body=object(raw);
  if(Object.keys(body).some(k=>k!=="answers") || !Array.isArray(body.answers) || body.answers.length!==questions.length) throw new ChallengeError(400,"invalid_challenge_answers");
  return body.answers.map((answer,i)=>{
    if(partial && answer===null) return null;
    if(!Number.isInteger(answer) || Number(answer)<0 || Number(answer)>=questions[i].options.length) throw new ChallengeError(400,"invalid_challenge_answers");
    return Number(answer);
  });
}
export function evaluateChallenge(questions:ChallengeQuestion[],answers:(number|null)[],passPercent:number) {
  if(answers.length!==questions.length || answers.some(a=>a===null)) throw new ChallengeError(400,"incomplete_challenge");
  const correct=questions.reduce((sum,q,i)=>sum+Number(q.correctIndex===answers[i]),0);
  return {correct,total:questions.length,passed:correct*100>=passPercent*questions.length,feedback:questions.map((q,i)=>({prompt:q.prompt,selectedIndex:answers[i],correct:answers[i]===q.correctIndex,correctIndex:q.correctIndex,explanation:q.explanation}))};
}
export function publicChallenge(row:Record<string,any>) {
  return {id:row.id,slug:row.slug,title:row.title,description:row.description,points:row.points,passPercent:row.pass_percent,active:row.active,
    questions:(row.questions as ChallengeQuestion[]).map(q=>({prompt:q.prompt,options:q.options})),completed:row.completed===true,earnedPoints:Number(row.earned_points??0)};
}
async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='10s'");const result=await work(client);await client.query("COMMIT");return result;}
  catch(error){await client.query("ROLLBACK").catch(()=>{});if(error instanceof ChallengeError) throw error;const code=(error as {code?:string}).code;if(code==="23505") throw new ChallengeError(409,"challenge_conflict");if(code==="42501") throw new ChallengeError(503,"challenge_permissions_unavailable");throw error;}
  finally{client.release();}
}
export async function listChallenges(pool:Pool,userId:string) {
  const result=await pool.query(`SELECT c.*,a.id IS NOT NULL AS completed,a.points AS earned_points FROM eco_challenges c
    LEFT JOIN eco_challenge_awards a ON a.challenge_id=c.id AND a.user_id=$1
    WHERE c.active=true OR a.id IS NOT NULL OR EXISTS(SELECT 1 FROM eco_challenge_attempts h WHERE h.challenge_id=c.id AND h.user_id=$1)
      OR EXISTS(SELECT 1 FROM eco_challenge_drafts d WHERE d.challenge_id=c.id AND d.user_id=$1)
    ORDER BY c.created_at,c.slug LIMIT 100`,[userId]);
  return result.rows.map(publicChallenge);
}
export async function loadChallenge(pool:Pool,userId:string,id:string){
  if(!uuidPattern.test(id)) throw new ChallengeError(400,"invalid_challenge_id");
  const result=await pool.query(`SELECT c.*,a.id IS NOT NULL AS completed,a.points AS earned_points FROM eco_challenges c
    LEFT JOIN eco_challenge_awards a ON a.challenge_id=c.id AND a.user_id=$2 WHERE c.id=$1 AND (c.active=true OR a.id IS NOT NULL
      OR EXISTS(SELECT 1 FROM eco_challenge_attempts h WHERE h.challenge_id=c.id AND h.user_id=$2)
      OR EXISTS(SELECT 1 FROM eco_challenge_drafts d WHERE d.challenge_id=c.id AND d.user_id=$2))`,[id,userId]);
  if(!result.rows[0]) throw new ChallengeError(404,"challenge_not_found");
  const drafts=await pool.query("SELECT answers FROM eco_challenge_drafts WHERE user_id=$1 AND challenge_id=$2",[userId,id]);
  const attempts=await pool.query("SELECT id,result,created_at AS \"createdAt\" FROM eco_challenge_attempts WHERE user_id=$1 AND challenge_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20",[userId,id]);
  return {...publicChallenge(result.rows[0]),draft:drafts.rows[0]?.answers??null,attempts:attempts.rows};
}
export async function saveChallengeDraft(pool:Pool,userId:string,id:string,raw:unknown){
  if(!uuidPattern.test(id)) throw new ChallengeError(400,"invalid_challenge_id");
  return transaction(pool,async client=>{
    const row=(await client.query("SELECT questions FROM eco_challenges WHERE id=$1 AND active=true FOR SHARE",[id])).rows[0];
    if(!row) throw new ChallengeError(404,"challenge_not_found");
    const answers=parseChallengeAnswers(raw,row.questions,true);
    await client.query(`INSERT INTO eco_challenge_drafts(user_id,challenge_id,answers) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(user_id,challenge_id) DO UPDATE SET answers=EXCLUDED.answers,updated_at=now()`,[userId,id,JSON.stringify(answers)]);
    return {saved:true};
  });
}
export async function submitChallenge(pool:Pool,userId:string,id:string,key:unknown,raw:unknown){
  if(!uuidPattern.test(id) || !validIdempotencyKey(key)) throw new ChallengeError(400,"invalid_challenge_submission");
  return transaction(pool,async client=>{
    // Same lock namespace as redemptions: concurrent spending and credits see
    // a consistent balance. Every statement is scoped to the authenticated ID.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",[userId]);
    const prior=(await client.query("SELECT id,challenge_id,answers,result FROM eco_challenge_attempts WHERE user_id=$1 AND idempotency_key=$2",[userId,key])).rows[0];
    if(prior){
      const supplied=object(raw);
      if(prior.challenge_id!==id || Object.keys(supplied).some(k=>k!=="answers") || JSON.stringify(prior.answers)!==JSON.stringify(supplied.answers)) throw new ChallengeError(409,"idempotency_key_reused");
      return {attemptId:prior.id,...prior.result,replayed:true};
    }
    const row=(await client.query("SELECT * FROM eco_challenges WHERE id=$1 AND active=true FOR SHARE",[id])).rows[0];
    if(!row) throw new ChallengeError(404,"challenge_not_found");
    const answers=parseChallengeAnswers(raw,row.questions);
    const result={...evaluateChallenge(row.questions,answers,row.pass_percent),awardedPoints:0};
    const attemptId=randomUUID();
    const awardId=randomUUID();
    // Serializing per principal makes this read stable even for different keys.
    const priorAward=(await client.query("SELECT id FROM eco_challenge_awards WHERE user_id=$1 AND challenge_id=$2",[userId,id])).rows[0];
    if(result.passed && !priorAward) result.awardedPoints=row.points;
    const hash=createHash("sha256").update(JSON.stringify({id,answers})).digest("hex");
    await client.query("INSERT INTO eco_challenge_attempts(id,user_id,challenge_id,idempotency_key,request_hash,answers,result,passed) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",[attemptId,userId,id,key,hash,JSON.stringify(answers),JSON.stringify(result),result.passed]);
    if(result.awardedPoints){
      await client.query("INSERT INTO eco_challenge_awards(id,user_id,challenge_id,attempt_id,points) VALUES($1,$2,$3,$4,$5)",[awardId,userId,id,attemptId,result.awardedPoints]);
      await client.query("INSERT INTO point_movements(id,user_id,delta,kind,source_id) VALUES($1,$2,$3,'education',$4)",[randomUUID(),userId,result.awardedPoints,awardId]);
    }
    return {attemptId,...result,replayed:false};
  });
}
export async function listAdminChallenges(pool:Pool){
  return (await pool.query("SELECT c.*,EXISTS(SELECT 1 FROM eco_challenge_attempts a WHERE a.challenge_id=c.id) AS locked FROM eco_challenges c ORDER BY created_at,slug LIMIT 100")).rows;
}
export async function saveAdminChallenge(pool:Pool,actorId:string,id:string|null,raw:unknown){
  const input=parseChallengeDefinition(raw);
  if(id!==null && !uuidPattern.test(id)) throw new ChallengeError(400,"invalid_challenge_id");
  return transaction(pool,async client=>{
    await lockCurrentAdministrator(client,actorId);
    const old=id?(await client.query("SELECT * FROM eco_challenges WHERE id=$1 FOR UPDATE",[id])).rows[0]:null;
    if(id && !old) throw new ChallengeError(404,"challenge_not_found");
    if(old){
      const used=(await client.query("SELECT id FROM eco_challenge_attempts WHERE challenge_id=$1 LIMIT 1",[id])).rows.length>0;
      if(used && (old.slug!==input.slug || old.title!==input.title || old.description!==input.description || old.points!==input.points || old.pass_percent!==input.passPercent || JSON.stringify(old.questions)!==JSON.stringify(JSON.parse(JSON.stringify(input.questions))))) {
        // jsonb key ordering differs from JavaScript; compare definitions in DB.
        const equal=(await client.query("SELECT questions=$2::jsonb AS same FROM eco_challenges WHERE id=$1",[id,JSON.stringify(input.questions)])).rows[0]?.same;
        if(!equal || old.slug!==input.slug || old.title!==input.title || old.description!==input.description || old.points!==input.points || old.pass_percent!==input.passPercent) throw new ChallengeError(409,"challenge_has_attempts");
      }
    }
    const challengeId=id??randomUUID();
    await client.query(`INSERT INTO eco_challenges(id,slug,title,description,questions,points,pass_percent,active) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
      ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,description=EXCLUDED.description,questions=EXCLUDED.questions,points=EXCLUDED.points,pass_percent=EXCLUDED.pass_percent,active=EXCLUDED.active`,[challengeId,input.slug,input.title,input.description,JSON.stringify(input.questions),input.points,input.passPercent,input.active]);
    await client.query("INSERT INTO eco_challenge_admin_events(id,actor_id,challenge_id,previous_state,next_state) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)",[randomUUID(),actorId,challengeId,old?JSON.stringify(old):null,JSON.stringify(input)]);
    return {id:challengeId};
  });
}
export async function seedChallenges(client:Pick<PoolClient,"query">){
  for(let index=0;index<initialChallenges.length;index++){
    const c=initialChallenges[index];
    const id=`ec000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`;
    await client.query("INSERT INTO eco_challenges(id,slug,title,description,questions,points,pass_percent,active) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT(slug) DO NOTHING",[id,c.slug,c.title,c.description,JSON.stringify(c.questions),c.points,c.passPercent,c.active]);
  }
}
