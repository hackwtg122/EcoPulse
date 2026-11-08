import assert from "node:assert/strict";
import test from "node:test";
import {initialChallenges} from "./challengeCatalog.ts";
import {parseChallengeDefinition,parseChallengeAnswers,evaluateChallenge,publicChallenge} from "./challenges.ts";
test("ten original challenge definitions have valid questions, ten points and unique identifiers",()=>{
  assert.equal(initialChallenges.length,10);assert.equal(new Set(initialChallenges.map(c=>c.slug)).size,10);
  for(const c of initialChallenges){assert.deepEqual(parseChallengeDefinition(c),c);assert.equal(c.points,10);assert.ok(c.questions.length>=2);}
});
test("every catalog challenge is scored by its server-side answer key",()=>{
  for(const c of initialChallenges){const answers=c.questions.map(q=>q.correctIndex);const result=evaluateChallenge(c.questions,parseChallengeAnswers({answers},c.questions),c.passPercent);assert.equal(result.passed,true);assert.equal(result.correct,result.total);assert.equal(result.feedback.length,c.questions.length);
    const wrong=c.questions.map(q=>(q.correctIndex+1)%q.options.length);assert.equal(evaluateChallenge(c.questions,wrong,c.passPercent).passed,false);
  }
});
test("participant definitions omit answer keys and explanations even if the DB row contains them",()=>{
  const c=initialChallenges[0];const view=publicChallenge({...c,id:"challenge",pass_percent:100,completed:false,privateFlag:"do not expose"});
  assert.ok(!JSON.stringify(view).includes("correctIndex"));assert.ok(!JSON.stringify(view).includes("explanation"));assert.equal(view.privateFlag,undefined);
  for(const q of view.questions)assert.deepEqual(Object.keys(q).sort(),["options","prompt"]);
});
test("requests cannot supply a score, actor, points or out-of-range answer indices",()=>{
  const questions=initialChallenges[0].questions;
  for(const raw of [{answers:[0,1],points:100},{answers:[0,1],userId:"other"},{answers:[0,1],passed:true},{answers:[0,1],score:100},{answers:[0]}, {answers:[null,1]}, {answers:[1.5,0]}, {answers:["1",0]}, {answers:[100,0]}, {answers:[-1,0]}])assert.throws(()=>parseChallengeAnswers(raw,questions));
  assert.deepEqual(parseChallengeAnswers({answers:[null,1]},questions,true),[null,1]);
});
test("future challenge policies reject malformed keys, empty options and invalid approval rules",()=>{
  const c=initialChallenges[0];
  for(const bad of [{...c,points:0},{...c,points:1001},{...c,passPercent:49},{...c,questions:[]},{...c,slug:"../invalid"},{...c,actorId:"other"},{...c,questions:[{...c.questions[0],correctIndex:99},c.questions[1]]},{...c,questions:[{...c.questions[0],options:["same","same"]},c.questions[1]]}])assert.throws(()=>parseChallengeDefinition(bad));
});
