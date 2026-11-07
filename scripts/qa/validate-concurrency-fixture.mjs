import { parseQAAccounts, safePrivateDiagnostic } from "./private-qa-policy.mjs";
try {
  const accounts=parseQAAccounts(process.env.PRODUCTION_QA_ACCOUNTS,{concurrent:true});
  const ready=accounts.length===20;
  console.log(JSON.stringify({check:"concurrency_fixture",status:ready?"PASS":"BLOCKED",distinctAccounts:accounts.length,requiredAccounts:20,loginsAttempted:0}));
  if(!ready) process.exitCode=1;
} catch(error) {
  console.log(JSON.stringify({check:"concurrency_fixture",status:"BLOCKED",...safePrivateDiagnostic(error),loginsAttempted:0}));
  process.exitCode=1;
}
