import assert from "node:assert/strict";
import test from "node:test";
import { reversibleFavoriteCheck } from "./private-write-check.mjs";

test("favorite write is verified and removed without revealing identity", async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const id = "00000000-0000-4000-8000-000000000001";
  let saved = false;
  globalThis.window = { Clerk: { session: { getToken: async () => "test-secret" } } };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("delivery-points")) return new Response(JSON.stringify({ points: [{ id }] }));
    if (url.endsWith("favorites")) return new Response(JSON.stringify({ enabled: true, ids: saved ? [id] : [] }));
    if (options.method === "POST") { saved = true; return new Response("{}", { status: 201 }); }
    if (options.method === "DELETE") { saved = false; return new Response(null, { status: 204 }); }
    throw Error("unexpected");
  };
  try {
    const result = await reversibleFavoriteCheck("https://ecopulse-3xb4.onrender.com");
    assert.equal(result.status, "PASS");
    assert.equal(saved, false);
    assert.ok(!JSON.stringify(result).includes(id));
    assert.ok(!JSON.stringify(result).includes("test-secret"));
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});

test("existing favorites are never modified", async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const id = "00000000-0000-4000-8000-000000000001";
  let writes = 0;
  globalThis.window = { Clerk: { session: { getToken: async () => "test-secret" } } };
  globalThis.fetch = async (url, options) => {
    if (options.method !== "GET") writes++;
    return new Response(JSON.stringify(url.endsWith("favorites") ? { enabled: true, ids: [id] } : { points: [{ id }] }));
  };
  try {
    assert.equal((await reversibleFavoriteCheck("https://ecopulse-3xb4.onrender.com")).status, "BLOCKED");
    assert.equal(writes, 0);
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});

test("a concurrently created favorite is not removed", async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const id = "00000000-0000-4000-8000-000000000001";
  let deletes = 0;
  globalThis.window = { Clerk: { session: { getToken: async () => "test-secret" } } };
  globalThis.fetch = async (url, options) => {
    if (options.method === "DELETE") deletes++;
    if (options.method === "POST") return new Response("{}", { status: 200 });
    return new Response(JSON.stringify(url.endsWith("favorites") ? { enabled: true, ids: [] } : { points: [{ id }] }));
  };
  try {
    assert.equal((await reversibleFavoriteCheck("https://ecopulse-3xb4.onrender.com")).status, "FAIL");
    assert.equal(deletes, 0);
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});
