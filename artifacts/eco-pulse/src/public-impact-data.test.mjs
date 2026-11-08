import assert from "node:assert/strict";
import test from "node:test";
import { readPublicImpact } from "./public-impact-data.ts";

const payload = {
  centers:8,challenges:10,rewards:3,verifiedDeliveries:0,
  points:[{id:"zone-1",name:"Zona EcoPulse Los Ángeles",municipality:"Montería",latitude:8.75,longitude:-75.88}],
  featuredRewards:[{id:"reward-1",title:"Kit digital de reciclaje",cost:20,kind:"guide-v1"}],
};
test("readPublicImpact accepts verified integer counters, including honest zero", () => {
  const data = readPublicImpact(payload);
  assert.equal(data.verifiedDeliveries,0);
  assert.equal(data.centers,8);
  assert.equal(data.featuredRewards[0].cost,20);
  assert.equal(data.points.length,1);
});
test("readPublicImpact rejects unknown or unverified metrics instead of inventing values", () => {
  for(const value of [null, {}, {...payload,centers:"8"}, {...payload,verifiedDeliveries:-1}, {...payload,rewards:3.2}, {...payload,points:[{id:"a",name:"b",municipality:"c",latitude:999,longitude:-75}]}]) {
    assert.throws(() => readPublicImpact(value));
  }
});
test("readPublicImpact does not serialize private fields from an untrusted response", () => {
  const data=readPublicImpact({...payload,email:"secret@example.org",userId:"secret",pointsBalance:4444});
  const json=JSON.stringify(data);
  assert.doesNotMatch(json,/secret|example\.org|pointsBalance/);
});
