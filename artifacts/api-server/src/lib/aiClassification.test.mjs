import assert from "node:assert/strict";
import test from "node:test";
import { AiClassificationError, parseAiSuggestion, sanitizePng, classifyImageWithOpenAI, consumeClassifyQuota } from "./aiClassification.ts";

const minimalPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==","base64");
test("image validation accepts a small PNG and rejects non-images", () => {
  assert.deepEqual(sanitizePng(minimalPng),minimalPng);
  const metadata = Buffer.concat([Buffer.from([0,0,0,8]),Buffer.from("tEXt"),Buffer.from("GPS\0fake"),Buffer.alloc(4)]);
  const withMetadata = Buffer.concat([minimalPng.subarray(0,33),metadata,minimalPng.subarray(33)]);
  assert.deepEqual(sanitizePng(withMetadata),minimalPng);
  assert.throws(() => sanitizePng(Buffer.from("not-an-image")),error => error instanceof AiClassificationError && error.code === "invalid_image");
  assert.throws(() => sanitizePng(Buffer.alloc(5*1024*1024+1)),error => error instanceof AiClassificationError && error.code === "invalid_image");
});
test("classification sends no persistent request and never returns points", async () => {
  let captured;
  const fakeFetch=async (_url,options) => {
    captured=JSON.parse(options.body);
    return { ok:true, async json() { return { output:[{ content:[{type:"output_text",text:'{"category":"paper","explanation":"Se observa papel blanco.","ambiguous":false,"confidence":"high"}'}] }] }; } };
  };
  const result=await classifyImageWithOpenAI(minimalPng,"test-only-secret","test-model",fakeFetch);
  assert.deepEqual(result,{category:"paper",explanation:"Se observa papel blanco.",ambiguous:false,confidence:"high",source:"ai_suggestion",persisted:false,points:0});
  assert.equal(captured.store,false);
  assert.match(captured.input[0].content[1].image_url,/^data:image\/png;base64,/);
});
test("classify quota limits repeated requests per account", () => {
  const account = `test-account-${Math.random()}`;
  for (let index = 0; index < 10; index += 1) assert.equal(consumeClassifyQuota(account), true);
  assert.equal(consumeClassifyQuota(account), false);
  assert.equal(consumeClassifyQuota(`${account}-other`), true);
});
test("provider output is a strict suggestion with grounded confidence only", () => {
  assert.deepEqual(parseAiSuggestion({category:"paper",explanation:"Se ven hojas blancas lisas.",ambiguous:false,confidence:"high"}),
    {category:"paper",explanation:"Se ven hojas blancas lisas.",ambiguous:false,confidence:"high"});
  assert.equal(parseAiSuggestion({category:"unknown",explanation:"No se distingue un material.",ambiguous:true,confidence:"medium"}).confidence, null);
  assert.equal(parseAiSuggestion({category:"glass",explanation:"Envase transparente.",ambiguous:true,confidence:null}).ambiguous, true);
  // Extra fields (points, persistence claims) are always rejected.
  assert.throws(() => parseAiSuggestion({category:"paper",explanation:"x",ambiguous:false,confidence:null,points:500}),
    error => error instanceof AiClassificationError && error.code === "invalid_ai_response");
  assert.throws(() => parseAiSuggestion({category:"recyclable",explanation:"x",ambiguous:false,confidence:null}),
    error => error instanceof AiClassificationError && error.code === "invalid_ai_category");
  assert.throws(() => parseAiSuggestion({category:"paper",explanation:"",ambiguous:false,confidence:null}),
    error => error instanceof AiClassificationError && error.code === "invalid_ai_response");
  assert.throws(() => parseAiSuggestion({category:"paper",explanation:"x",ambiguous:false,confidence:"certain"}),
    error => error instanceof AiClassificationError && error.code === "invalid_ai_response");
});
