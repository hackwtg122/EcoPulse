import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import {listChallenges,loadChallenge,saveChallengeDraft,submitChallenge,saveAdminChallenge} from "../../artifacts/api-server/src/lib/challenges.ts";
import {initialChallenges} from "../../artifacts/api-server/src/lib/challengeCatalog.ts";
import {redeemReward,fulfillRedemption,restockReward} from "../../artifacts/api-server/src/lib/rewardService.ts";
import {ownedDigitalAsset,digitalAssetCatalog} from "../../artifacts/api-server/src/lib/digitalAssets.ts";
import {createCoordinationRequest,cancelOwnCoordinationRequest,listOwnCoordinationRequests} from "../../artifacts/api-server/src/lib/coordinationRequests.ts";
import {percentile} from "./concurrency-20.mjs";

export async function verifyIsolatedChallenges(pool){
  const db=(await pool.query("SELECT current_database() AS db,host(inet_server_addr()) AS host")).rows[0];
  assert.equal(db.db,"ecopulse_release");assert.ok(["127.0.0.1","::1"].includes(db.host));
  const stamp=randomUUID().replaceAll("-","");const admin=`user_RetosAdmin${stamp}`;const users=Array.from({length:20},(_,i)=>`user_Retos${i}${stamp}`);
  for(const id of [admin,...users])await pool.query("INSERT INTO users(clerk_user_id,role) VALUES($1,$2)",[id,id===admin?"admin":"participant"]);
  const challenges=await listChallenges(pool,users[0]);assert.equal(challenges.length,10);
  assert.ok(!JSON.stringify(challenges).includes("correctIndex"));assert.ok(!JSON.stringify(challenges).includes("explanation"));
  const first=challenges.find(c=>c.slug===initialChallenges[0].slug);const answers=initialChallenges[0].questions.map(q=>q.correctIndex);
  await saveChallengeDraft(pool,users[0],first.id,{answers:[answers[0],null]});
  assert.deepEqual((await loadChallenge(pool,users[0],first.id)).draft,[answers[0],null]);
  assert.equal((await loadChallenge(pool,users[1],first.id)).draft,null);
  const wrong=initialChallenges[0].questions.map(q=>(q.correctIndex+1)%q.options.length);
  const failed=await submitChallenge(pool,users[0],first.id,`failed_${stamp}`,{answers:wrong});assert.equal(failed.passed,false);assert.equal(failed.awardedPoints,0);
  const storm=await Promise.all(Array.from({length:20},(_,i)=>submitChallenge(pool,users[0],first.id,`storm_${stamp}_${i}`,{answers})));
  assert.equal(storm.reduce((sum,r)=>sum+r.awardedPoints,0),10);
  const replay=await submitChallenge(pool,users[0],first.id,`storm_${stamp}_0`,{answers});assert.equal(replay.replayed,true);
  await assert.rejects(submitChallenge(pool,users[0],first.id,`storm_${stamp}_0`,{answers:wrong}),{code:"idempotency_key_reused"});
  await assert.rejects(submitChallenge(pool,users[1],first.id,`forged_${stamp}`,{answers,points:999}),{status:400});
  await assert.rejects(saveAdminChallenge(pool,users[1],first.id,initialChallenges[0]),{code:"admin_required"});
  await assert.rejects(saveAdminChallenge(pool,admin,first.id,{...initialChallenges[0],points:100}),{code:"challenge_has_attempts"});
  const forgedAttempt=randomUUID();
  await assert.rejects(pool.query("INSERT INTO eco_challenge_attempts(id,user_id,challenge_id,idempotency_key,request_hash,answers,result,passed) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,true)",[forgedAttempt,users[1],first.id,`forged_sql_${stamp}`,"a".repeat(64),JSON.stringify(wrong),JSON.stringify({correct:2,total:2,passed:true,awardedPoints:10})]),{code:"23514"});
  await assert.rejects(pool.query("INSERT INTO point_movements(id,user_id,delta,kind,source_id) VALUES($1,$2,100,'education',$3)",[randomUUID(),users[0],randomUUID()]),{code:"23514"});
  for(const challenge of challenges){const definition=initialChallenges.find(c=>c.slug===challenge.slug);const correct=definition.questions.map(q=>q.correctIndex);
    await Promise.all(users.map(id=>submitChallenge(pool,id,challenge.id,`pass_${stamp}_${challenge.slug}`,{answers:correct})));
  }
  const balances=await pool.query("SELECT user_id,sum(delta)::int AS balance,count(*)::int AS credits FROM point_movements WHERE user_id=ANY($1::text[]) GROUP BY user_id",[users]);
  assert.equal(balances.rows.length,20);assert.ok(balances.rows.every(r=>r.balance===100&&r.credits===10));
  assert.equal((await loadChallenge(pool,users[1],first.id)).attempts.length,1);
  const rewards=(await pool.query("SELECT id,title,cost,fulfillment_reference,inventory_remaining FROM rewards WHERE id::text LIKE 'e1f002%' ORDER BY cost")).rows;
  assert.deepEqual(rewards.map(r=>r.cost),[20,40,80]);assert.equal(rewards.length,3);
  const snapshots=structuredClone(rewards.map(({id,title,cost,fulfillment_reference})=>({id,title,cost,fulfillment_reference})));
  for(const reward of rewards){await restockReward(pool,admin,reward.id,`capacity_${stamp}_${reward.cost}`,{quantity:Math.max(20-reward.inventory_remaining,1),evidenceReference:reward.fulfillment_reference,availabilityConfirmed:true});}
  const redeemed=await Promise.all(users.map(id=>redeemReward(pool,id,rewards[0].id,`redeem_${stamp}`)));
  await Promise.all(users.map(id=>redeemReward(pool,id,rewards[0].id,`redeem_${stamp}`)));
  assert.equal((await pool.query("SELECT inventory_remaining FROM rewards WHERE id=$1",[rewards[0].id])).rows[0].inventory_remaining,0);
  await assert.rejects(redeemReward(pool,users[0],rewards[0].id,`oversold_${stamp}`),{code:"reward_unavailable"});
  const asset=digitalAssetCatalog().find(a=>a.rewardTitle===rewards[0].title);
  assert.equal(await ownedDigitalAsset(pool,users[0],redeemed[0].redemption.id),null);
  await Promise.all(redeemed.map(r=>fulfillRedemption(pool,admin,r.redemption.id,asset.fulfillmentReference)));
  const file=await ownedDigitalAsset(pool,users[0],redeemed[0].redemption.id);
  assert.equal(createHash("sha256").update(file.content).digest("hex"),asset.sha256);
  assert.equal(await ownedDigitalAsset(pool,users[1],redeemed[0].redemption.id),null);
  for(let i=1;i<3;i++){const r=await redeemReward(pool,users[i],rewards[i].id,`other_${stamp}_${i}`);const a=digitalAssetCatalog().find(a=>a.rewardTitle===rewards[i].title);await fulfillRedemption(pool,admin,r.redemption.id,a.fulfillmentReference);const bytes=await ownedDigitalAsset(pool,users[i],r.redemption.id);assert.equal(createHash("sha256").update(bytes.content).digest("hex"),a.sha256);}
  const after=(await pool.query("SELECT id,title,cost,fulfillment_reference FROM rewards WHERE id::text LIKE 'e1f002%' ORDER BY cost")).rows;assert.deepEqual(after,snapshots);
  const requests=await Promise.all(users.map(id=>createCoordinationRequest(pool,id,`coord_${stamp}`,{materials:[{categoryCode:"paper",estimatedGrams:1000}],note:"Isolated test"})));
  await Promise.all(requests.map((r,i)=>cancelOwnCoordinationRequest(pool,users[i],r.request.id)));
  for(let i=0;i<20;i++){const own=await listOwnCoordinationRequests(pool,users[i]);assert.equal(own.length,1);assert.equal(own[0].id,requests[i].request.id);assert.equal(own[0].status,"cancelled");}
  const duration=Number(process.env.CHALLENGE_LOAD_MS||"300000");if(!Number.isInteger(duration)||duration<1000)throw Error("invalid_load_duration");
  const measurements=[];let errors=0;let maxConnections=0;const cpu=process.cpuUsage();const start=Date.now();const deadline=start+duration;
  await Promise.all(users.map(async(id,index)=>{let sequence=0;while(Date.now()<deadline){const before=performance.now();try{
    const challenge=challenges[sequence%challenges.length];const definition=initialChallenges.find(c=>c.slug===challenge.slug);
    if(sequence%5===0)await submitChallenge(pool,id,challenge.id,`load_${stamp}_${index}_${sequence}`,{answers:definition.questions.map(q=>q.correctIndex)});
    else if(sequence%5===1)await loadChallenge(pool,id,challenge.id);
    else if(sequence%5===2)await listChallenges(pool,id);
    else if(sequence%5===3)await listOwnCoordinationRequests(pool,id);
    else await pool.query("SELECT coalesce(sum(delta),0) FROM point_movements WHERE user_id=$1",[id]);
    maxConnections=Math.max(maxConnections,pool.totalCount);
  }catch{errors++;}measurements.push(performance.now()-before);sequence++;await sleep(Math.max(1,Math.min(1000,deadline-Date.now())));}}));
  assert.equal(errors,0);
  const awardCount=(await pool.query("SELECT count(*)::int AS n FROM eco_challenge_awards WHERE user_id=ANY($1::text[])",[users])).rows[0].n;assert.equal(awardCount,200);
  const final=(await pool.query("SELECT min(total)::int AS min_balance FROM (SELECT sum(delta) AS total FROM point_movements WHERE user_id=ANY($1::text[]) GROUP BY user_id) s",[users])).rows[0];assert.equal(final.min_balance,0);
  const cpuDelta=process.cpuUsage(cpu);
  return {challengeChecks:{catalogCount:10,isolatedPrincipals:20,distinctClerkSessions:0,awardCount,pointsPerChallenge:10,concurrentDuplicateCreditPrevented:true,forgedResultRejected:true,answerKeyHidden:true,draftIsolation:true,completedHistoryPersists:true,digitalRedemptions:22,threeFilesHashMatched:true,foreignDownloadDenied:true,originalRewardsUnchanged:true},challengeLoad:{scope:"isolated_postgresql_services_not_authenticated_http",workers:20,durationSeconds:Math.round((Date.now()-start)/1000),operations:measurements.length,p50Ms:Math.round(percentile(measurements,.5)*100)/100,p95Ms:Math.round(percentile(measurements,.95)*100)/100,errors,http429:null,http5xx:null,maxDatabaseConnections:maxConnections,nodeCpuUserMs:Math.round(cpuDelta.user/1000),nodeCpuSystemMs:Math.round(cpuDelta.system/1000),nodeRssBytes:process.memoryUsage().rss,renderResourcesMeasured:false}};
}
