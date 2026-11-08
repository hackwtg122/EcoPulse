import {pathToFileURL} from "node:url";
import {join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {summarize} from "./concurrency-20.mjs";

// Explicitly authorized existing principals only. No passwords, account
// creation, session export, impersonation of the administrator or MFA changes.
export function parseTicketIdentities(raw){
  if(!raw)throw Error("authorized_test_identities_missing");
  let config;try{config=JSON.parse(raw||"");}catch{throw Error("qa_identities_json_invalid");}
  if(config?.version!==1 || config.authorized!==true || !Array.isArray(config.accounts) || config.accounts.length!==20)throw Error("twenty_authorized_identities_required");
  const ids=new Set();
  return config.accounts.map(account=>{
    if(!account || Object.keys(account).some(k=>!["userId","role","testOnly","profilePreexists"].includes(k)) || account.role!=="participant" || account.testOnly!==true || account.profilePreexists!==true || !/^user_[A-Za-z0-9]{3,64}$/.test(account.userId) || ids.has(account.userId))throw Error("invalid_or_duplicate_test_identity");
    ids.add(account.userId);return {userId:account.userId,role:"participant"};
  });
}
async function main(){
  const accounts=parseTicketIdentities(process.env.CONCURRENCY_QA_IDENTITIES);
  if(process.argv.includes("--validate-only")){console.log(JSON.stringify({check:"passwordless_concurrency_fixture",status:"PASS",distinctAccounts:accounts.length,passwordsUsed:0,loginsAttempted:0}));return;}
  if(process.env.CONCURRENCY_AUTHORIZED!=="true")throw Error("explicit_concurrency_authorization_required");
  const frontend=process.env.QA_FRONTEND_URL||"https://ecopulseef.netlify.app";
  const api=process.env.QA_BASE_URL||"https://ecopulse-3xb4.onrender.com";
  if((frontend!=="https://ecopulseef.netlify.app"||api!=="https://ecopulse-3xb4.onrender.com")&&process.env.CONCURRENCY_ISOLATED!=="true")throw Error("isolated_environment_authorization_required");
  const duration=Number(process.env.CONCURRENCY_DURATION_MS||"300000");if(!Number.isInteger(duration)||duration<300000)throw Error("five_minutes_required");
  if(!process.env.CLERK_SECRET_KEY || !process.env.PROD_QA_MODULES_DIR || !process.env.CHROME_PATH)throw Error("passwordless_runner_configuration_required");
  const {chromium}=await import(pathToFileURL(join(process.env.PROD_QA_MODULES_DIR,"playwright-core","index.mjs")).href);
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  const records=[],sessions=[];let start;
  try{
    for(const account of accounts){
      const context=await browser.newContext({serviceWorkers:"block"});let identityApproved=false;
      await context.route("**/api/pilot/**",route=>identityApproved&&route.request().method()==="GET"?route.continue():route.abort());
      const page=await context.newPage();
      await page.goto(`${frontend}/sign-in`,{waitUntil:"domcontentloaded",timeout:60000});
      await page.waitForFunction(()=>Boolean(window.Clerk?.loaded),null,{timeout:60000});
      const response=await fetch("https://api.clerk.com/v1/sign_in_tokens",{method:"POST",headers:{Authorization:`Bearer ${process.env.CLERK_SECRET_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({user_id:account.userId,expires_in_seconds:600}),signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error("clerk_test_ticket_rejected");
      const ticket=(await response.json()).token;
      if(typeof ticket!=="string")throw Error("clerk_test_ticket_missing");
      const matches=await page.evaluate(async({ticket,id})=>{
        const signIn=await window.Clerk.client.signIn.create({strategy:"ticket",ticket});
        if(signIn.status!=="complete")return false;
        await window.Clerk.setActive({session:signIn.createdSessionId});
        return true;
      },{ticket,id:account.userId});
      if(!matches)throw Error("qa_fixture_identity_mismatch");
      await page.waitForFunction(id=>window.Clerk?.user?.id===id,account.userId,{timeout:30000});
      identityApproved=true;
      const roleMatches=await page.evaluate(async({api,id})=>{const token=await window.Clerk.session.getToken();const r=await fetch(`${api}/api/pilot/me`,{headers:{Authorization:`Bearer ${token}`}});const me=await r.json();return r.ok&&me.id===id&&me.role==="participant";},{api,id:account.userId});
      if(!roleMatches)throw Error("qa_application_role_mismatch");
      await page.goto(`${frontend}/dashboard`,{waitUntil:"domcontentloaded",timeout:60000});
      await page.getByTestId("dashboard-real-data").waitFor({state:"visible",timeout:60000});
      await page.goto(`${frontend}/progress?section=challenges`,{waitUntil:"domcontentloaded",timeout:60000});
      await page.getByTestId("challenges-panel").waitFor({state:"visible",timeout:60000});
      sessions.push(page);
    }
    const paths=["me","balance","progress","delivery-points","coordination-requests","challenges","redemptions","point-movements","rewards"];
    start=Date.now();const deadline=start+duration;
    await Promise.all(sessions.map(async(page)=>{let index=0;while(Date.now()<deadline){const before=Date.now();let status=null;try{status=await page.evaluate(async({api,path})=>{const token=await window.Clerk.session.getToken();const response=await fetch(`${api}/api/pilot/${path}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:AbortSignal.timeout(30000)});await response.arrayBuffer();return response.status;},{api,path:paths[index++%paths.length]});}catch{}records.push({ms:Date.now()-before,status});await sleep(Math.max(1,Math.min(1000,deadline-Date.now())));}}));
    const unexpected=records.filter(r=>r.status!==200).length;
    console.log(JSON.stringify({check:"twenty_clerk_sessions",status:unexpected?"FAIL":"PASS",distinctAccounts:20,independentBrowserContexts:20,passwordsUsed:0,usersCreated:0,scope:"authenticated_read_only_not_mutation_load",...summarize(records,Date.now()-start),unexpectedResponses:unexpected,renderResourceMetricsAvailable:false}));
    if(unexpected)process.exitCode=1;
  }finally{await browser.close();}
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
  try{await main();}catch(error){const reason=/^[a-z_]+$/.test(error.message||"")?error.message:"passwordless_qa_failed";console.log(JSON.stringify({check:"twenty_clerk_sessions",status:"BLOCKED",reason,passwordsUsed:0}));process.exitCode=1;}
}
