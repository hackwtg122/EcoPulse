export type ChallengeQuestion={prompt:string;options:string[]};
export type Challenge={id:string;slug:string;title:string;description:string;points:number;passPercent:number;active:boolean;questions:ChallengeQuestion[];completed:boolean;earnedPoints:number};
export type ChallengeResult={attemptId?:string;correct:number;total:number;passed:boolean;awardedPoints:number;feedback:Array<{prompt:string;selectedIndex:number;correct:boolean;correctIndex:number;explanation:string}>;replayed?:boolean};
export type ChallengeDetail=Challenge & {draft:(number|null)[]|null;attempts:Array<{id:string;createdAt:string;result:ChallengeResult}>};
export type AdminChallengeInput={slug:string;title:string;description:string;questions:Array<ChallengeQuestion & {correctIndex:number;explanation:string}>;points:number;passPercent:number;active:boolean};
export type AdminChallenge=AdminChallengeInput & {id:string;locked:boolean};
export class ChallengeApiError extends Error {status:number;constructor(status:number,code:string){super(code);this.status=status;}}
async function call(api:string,token:string,path:string,signal:AbortSignal,method="GET",body?:unknown,key?:string,fetcher:typeof fetch=fetch){
  const response=await fetcher(`${api}/api/pilot/${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},cache:"no-store",signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new ChallengeApiError(response.status,typeof error.error==="string"?error.error:"challenge_request_failed");}
  return response.json();
}
function challenge(row:any):Challenge{
  if(!row || typeof row.id!=="string" || typeof row.title!=="string" || !Array.isArray(row.questions) || !Number.isInteger(row.points) || typeof row.completed!=="boolean") throw new ChallengeApiError(502,"invalid_challenge_response");
  return {id:row.id,slug:row.slug,title:row.title,description:row.description,points:row.points,passPercent:row.passPercent,active:row.active,completed:row.completed,earnedPoints:row.earnedPoints,questions:row.questions.map((q:any)=>{
    if(typeof q.prompt!=="string" || !Array.isArray(q.options) || !q.options.every((o:unknown)=>typeof o==="string")) throw new ChallengeApiError(502,"invalid_challenge_question");
    return {prompt:q.prompt,options:q.options};
  })};
}
export async function loadChallenges(api:string,token:string,signal:AbortSignal,fetcher?:typeof fetch):Promise<Challenge[]>{
  const body=await call(api,token,"challenges",signal,"GET",undefined,undefined,fetcher);
  if(!Array.isArray(body.items)) throw new ChallengeApiError(502,"invalid_challenge_list");
  return body.items.map(challenge);
}
export async function loadChallenge(api:string,token:string,id:string,signal:AbortSignal):Promise<ChallengeDetail>{
  const row=await call(api,token,`challenges/${encodeURIComponent(id)}`,signal);
  if(!Array.isArray(row.attempts)) throw new ChallengeApiError(502,"invalid_challenge_history");
  return {...challenge(row),draft:row.draft,attempts:row.attempts};
}
export async function saveChallengeDraft(api:string,token:string,id:string,answers:(number|null)[],signal:AbortSignal){
  return call(api,token,`challenges/${encodeURIComponent(id)}/draft`,signal,"PUT",{answers});
}
export async function submitChallenge(api:string,token:string,id:string,key:string,answers:(number|null)[],signal:AbortSignal,fetcher?:typeof fetch):Promise<ChallengeResult>{
  const row=await call(api,token,`challenges/${encodeURIComponent(id)}/submit`,signal,"POST",{answers},key,fetcher);
  if(typeof row.attemptId!=="string" || typeof row.passed!=="boolean" || !Number.isInteger(row.correct) || !Number.isInteger(row.total) || !Number.isInteger(row.awardedPoints) || !Array.isArray(row.feedback)) throw new ChallengeApiError(502,"invalid_challenge_result");
  return row;
}
export async function loadAdminChallenges(api:string,token:string,signal:AbortSignal):Promise<AdminChallenge[]>{
  const body=await call(api,token,"admin/challenges",signal);
  if(!Array.isArray(body.items)) throw new ChallengeApiError(502,"invalid_challenge_list");
  return body.items.map((row:any)=>({id:row.id,slug:row.slug,title:row.title,description:row.description,questions:row.questions,points:row.points,passPercent:row.pass_percent,active:row.active,locked:row.locked}));
}
export async function saveAdminChallenge(api:string,token:string,id:string|null,input:AdminChallengeInput,signal:AbortSignal){
  return call(api,token,id?`admin/challenges/${encodeURIComponent(id)}`:"admin/challenges",signal,id?"PUT":"POST",input);
}
