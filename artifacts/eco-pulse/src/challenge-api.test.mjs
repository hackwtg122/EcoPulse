import assert from "node:assert/strict";
import test from "node:test";
import {loadChallenges,submitChallenge,ChallengeApiError} from "./challenge-api.ts";
test("client displays only public question fields and never retains a supplied key",async()=>{
  const rows=await loadChallenges("https://api.invalid","token",new AbortController().signal,async(url,init)=>{
    assert.equal(init.headers.Authorization,"Bearer token");assert.equal(init.cache,"no-store");
    return new Response(JSON.stringify({items:[{id:"id",slug:"slug",title:"Reto",description:"Desc",points:10,passPercent:100,active:true,completed:false,earnedPoints:0,questions:[{prompt:"Pregunta",options:["A","B"],correctIndex:1,explanation:"secret"}]}]}));
  });
  assert.deepEqual(rows[0].questions,[{prompt:"Pregunta",options:["A","B"]}]);
});
test("submission sends answers and a stable key, never client-awarded points or identity",async()=>{
  const result=await submitChallenge("https://api.invalid","token","id","stable_key_123",[1,0],new AbortController().signal,async(url,init)=>{
    assert.equal(init.headers["Idempotency-Key"],"stable_key_123");assert.deepEqual(JSON.parse(init.body),{answers:[1,0]});
    return new Response(JSON.stringify({attemptId:"attempt",correct:2,total:2,passed:true,awardedPoints:10,feedback:[]}));
  });assert.equal(result.awardedPoints,10);
});
test("denied and malformed results cannot masquerade as awarded points",async()=>{
  for(const [status,body] of [[409,{error:"idempotency_key_reused"}],[200,{passed:true,points:100}]]){
    await assert.rejects(submitChallenge("https://api.invalid","token","id","stable_key_123",[1,0],new AbortController().signal,async()=>new Response(JSON.stringify(body),{status})),e=>e instanceof ChallengeApiError);
  }
});
