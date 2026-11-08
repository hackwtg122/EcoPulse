import assert from "node:assert/strict";
import test from "node:test";
import {parseTicketIdentities} from "./concurrency-ticket.mjs";
const fixture=()=>({version:1,authorized:true,accounts:Array.from({length:20},(_,i)=>({userId:`user_TestLocal${i}`,role:"participant",testOnly:true,profilePreexists:true}))});
test("twenty distinct authorized existing identities need no credentials",()=>assert.equal(parseTicketIdentities(JSON.stringify(fixture())).length,20));
test("admin identities, passwords, missing attestations and duplicates fail closed",()=>{
  for(const change of [c=>c.authorized=false,c=>c.accounts.pop(),c=>c.accounts[1].userId=c.accounts[0].userId,c=>c.accounts[0].role="admin",c=>c.accounts[0].password="forbidden",c=>c.accounts[0].testOnly=false,c=>c.accounts[0].profilePreexists=false]){const c=fixture();change(c);assert.throws(()=>parseTicketIdentities(JSON.stringify(c)));}
  assert.throws(()=>parseTicketIdentities("not-json"));
});
