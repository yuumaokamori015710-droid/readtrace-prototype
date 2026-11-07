import test from "node:test";
import assert from "node:assert/strict";
import { sharedTtl, cacheIdentity, createCatalogTransport } from "../supabase/functions/readtrace-books/catalog-guard.mjs";
import { createCatalogHandler } from "../supabase/functions/readtrace-books/catalog-handler.mjs";
import { createBookClient, resultCacheMs } from "./readtrace-books.mjs";

function memoryRpc() {
  const cache = new Map(), calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name.endsWith("gate") || name.endsWith("preflight")) return { allowed: true };
    if (name.endsWith("claim")) {
      if (cache.has(args.p_key)) return { state: "hit", payload: cache.get(args.p_key), ttl: 120 };
      return { state: "miss", token: "lease" };
    }
    if (args.p_payload && args.p_ttl) cache.set(args.p_key, args.p_payload);
    return true;
  };
  return { rpc, calls, cache };
}
const request = (query = "こころ", extra = {}, headers = {}) => new Request("https://example.com/books", {
  method: "POST", headers: { apikey: "public", "Content-Type": "application/json", ...headers }, body: JSON.stringify({ query, ...extra }),
});

test("shared cache respects upstream private/no-store/no-cache and Google header lifetime", () => {
  for (const directive of ["private, max-age=3600", "no-store", "no-cache", "max-age=0"]) assert.equal(sharedTtl(new Headers({ "cache-control": directive }), "google"), 0);
  assert.equal(sharedTtl(new Headers(), "google"), 0);
  assert.equal(sharedTtl(new Headers({ "cache-control": "public, max-age=3600", age: "60" }), "google"), 3540);
  assert.equal(sharedTtl(new Headers({ "cache-control": "max-age=3600, s-maxage=60" }), "google"), 60);
  assert.equal(sharedTtl(new Headers({ "cache-control": "max-age=9999999" }), "google"), 86400);
  assert.equal(sharedTtl(new Headers(), "openlibrary"), 21600);
});

test("cache identity removes credentials and normalizes query parameter ordering", () => {
  const key = cacheIdentity("https://www.googleapis.com/books/v1/volumes?key=secret&q=test&quotaUser=person");
  assert.equal(key, cacheIdentity("https://www.googleapis.com/books/v1/volumes?q=test&key=rotated"));
  assert.ok(!key.includes("secret") && !key.includes("person"));
});

test("separate transports share persistent cached data without another upstream fetch", async () => {
  const { rpc, calls } = memoryRpc(); let count = 0;
  const fetcher = async () => { count++; return new Response('{"docs":[]}', { headers: { "cache-control": "public, max-age=120" } }); };
  const url = new URL("https://openlibrary.org/search.json?q=book");
  await createCatalogTransport({ rpc, fetcher }).fetch(url);
  const second = createCatalogTransport({ rpc, fetcher });
  assert.equal(await (await second.fetch(url)).text(), '{"docs":[]}');
  assert.equal(count, 1); assert.equal(second.stats.hits, 1);
  assert.match(calls[0].args.p_key, /^[a-f0-9]{64}$/);
});

test("simultaneous identical requests have one upstream fetch", async () => {
  const { rpc } = memoryRpc(); let count = 0;
  const transport = createCatalogTransport({ rpc, fetcher: async () => { count++; await new Promise(r => setTimeout(r, 10)); return new Response('{}'); } });
  const responses = await Promise.all([transport.fetch("https://www.googleapis.com/books/v1/volumes?q=same"), transport.fetch("https://www.googleapis.com/books/v1/volumes?q=same")]);
  assert.equal(count, 1); assert.equal(await responses[0].text(), await responses[1].text());
});

test("private Google responses are not persisted or granted a browser cache lifetime", async () => {
  const { rpc, cache, calls } = memoryRpc();
  const transport = createCatalogTransport({ rpc, fetcher: async () => new Response('{"items":[1]}', { headers: { "cache-control": "private, max-age=0" } }) });
  await transport.fetch("https://www.googleapis.com/books/v1/volumes?key=secret&q=test");
  assert.equal(cache.size, 0); assert.equal(transport.stats.googleTtl, 0);
  assert.equal(calls.at(-1).args.p_payload, null);
  assert.equal(JSON.stringify(calls).includes("secret"), false);
});

test("global Google budget denial never contacts Google", async () => {
  let calls = 0;
  const transport = createCatalogTransport({ rpc: async () => ({ state: "budget" }), fetcher: async () => { calls++; } });
  assert.equal((await transport.fetch("https://www.googleapis.com/books/v1/volumes?q=book")).status, 503);
  assert.equal(calls, 0); assert.equal(transport.stats.blocked, 1);
});

test("HTTP-200 provider error documents are not cached as successful results", async () => {
  const { rpc, cache } = memoryRpc();
  const transport = createCatalogTransport({ rpc, fetcher: async () => new Response('{"error":{"code":"maxlag"}}', { headers: { "cache-control": "public, max-age=3600" } }) });
  assert.equal((await transport.fetch("https://www.wikidata.org/w/api.php?action=wbsearchentities")).status, 503);
  assert.equal(cache.size, 0);
});

test("Google daily quota errors set a shared daily cooldown and always release the lease", async () => {
  const { rpc, calls } = memoryRpc();
  const transport = createCatalogTransport({ rpc, fetcher: async () => new Response('{"error":"Queries per day exceeded"}', { status: 429 }) });
  await transport.fetch("https://www.googleapis.com/books/v1/volumes?q=book");
  assert.equal(calls.at(-1).args.p_block, "day"); assert.equal(calls.at(-1).args.p_payload, null);
});

test("rate limit has Retry-After, does not fetch upstream, and never stores raw identity", async () => {
  const calls = []; let fetched = 0;
  const handler = createCatalogHandler({ url: "https://example.supabase.co", serviceKey: "internal-only", clientKey: "public", rpc: async (name, args) => { calls.push(args); return { allowed: false, kind: "minute", retryAfter: 60 }; }, fetcher: async () => { fetched++; } });
  const response = await handler(request("こころ", {}, { "x-forwarded-for": "192.0.2.42" }));
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(fetched, 0);
  assert.equal(JSON.stringify(calls).includes("192.0.2.42"), false);
});

test("input errors are rejected before quota reservations or network access", async () => {
  let count = 0;
  const handler = createCatalogHandler({ clientKey: "public", rpc: async () => { count++; } });
  assert.equal((await handler(request("123", { field: "isbn" }))).status, 400);
  assert.equal((await handler(request("x".repeat(5000)))).status, 400);
  assert.equal((await handler(request("", {}))).status, 400);
  assert.equal(count, 0);
});

test("an unverified token cannot claim an authenticated user budget", async () => {
  let rpcCalls = 0;
  const handler = createCatalogHandler({ clientKey: "public", serviceKey: "internal", url: "https://example.supabase.co", rpc: async name => { assert.ok(name.endsWith("preflight")); rpcCalls++; return { allowed: true }; }, fetcher: async () => new Response('{}', { status: 401 }) });
  assert.equal((await handler(request("book", {}, { authorization: "Bearer forged" }))).status, 401);
  assert.equal(rpcCalls, 1);
});

test("preflight limits invalid tokens before they can flood Auth", async () => {
  let attempts = 0, authCalls = 0;
  const handler = createCatalogHandler({ clientKey: "public", serviceKey: "internal", url: "https://example.supabase.co", rpc: async name => {
    assert.ok(name.endsWith("preflight")); return { allowed: ++attempts <= 60, retryAfter: 60 };
  }, fetcher: async () => { authCalls++; return new Response('{}', { status: 401 }); } });
  for (let i=0;i<65;i++) assert.equal((await handler(request("book",{}, {authorization:'Bearer forged'}))).status, i<60 ? 401 : 429);
  assert.equal(authCalls,60);
});

test("JSON escaping cannot make an oversized payload fail a successful response", async () => {
  const { rpc,cache }=memoryRpc(); const body=JSON.stringify({ docs: ["\\".repeat(60000)] });
  const transport=createCatalogTransport({rpc,fetcher:async()=>new Response(body,{headers:{'cache-control':'public, max-age=600'}})});
  const response=await transport.fetch('https://openlibrary.org/search.json?q=large');
  assert.equal(response.status,200); assert.equal(await response.text(),body); assert.equal(cache.size,0);
});

test("query and discovery cache lifetimes preserve zero and cap positive server TTLs",()=>{
  assert.equal(resultCacheMs({cacheTtlSeconds:0}),0);
  assert.equal(resultCacheMs({cacheTtlSeconds:120}),120000);
  assert.equal(resultCacheMs({cacheTtlSeconds:86400}),600000);
});

test("nested browser caches receive remaining lifetime rather than renewing freshness",async t=>{
  let now=0,calls=0; t.mock.method(Date,'now',()=>now);
  const client=createBookClient({endpoint:'https://example.com/books',fetcher:async()=>{calls++;return new Response('{"items":[],"cacheTtlSeconds":120}');}});
  await client.search({query:'book'}); now=100000;
  assert.equal((await client.search({query:'book'})).cacheTtlSeconds,20);
  now=121000; await client.search({query:'book'}); assert.equal(calls,2);
});

test("last supported page terminates pagination and higher pages are rejected",async()=>{
  const {rpc}=memoryRpc();
  const handler=createCatalogHandler({clientKey:'public',serviceKey:'internal',rpc,fetcher:async url=>new Response(JSON.stringify(url.hostname.includes('googleapis') ? {totalItems:10000,items:[{id:'one',volumeInfo:{title:'One'}}]} : {numFound:10000,docs:[]}))});
  const response=await handler(request('book',{page:20}));
  assert.equal(response.status,200); assert.equal((await response.json()).hasMore,false);
  assert.equal((await handler(request('book',{page:21}))).status,400);
});

test("configured client never bypasses a rate limit or outage with direct API calls", async () => {
  for (const status of [401, 429, 503]) {
    const urls = [];
    const client = createBookClient({ endpoint: "https://example.com/books", publishableKey: "public", fetcher: async url => { urls.push(url); return new Response('{"error":"検索制限"}', { status, headers: { "Retry-After": "60" } }); } });
    await assert.rejects(client.search({ query: "book" }), error => error.status === status && error.retryAfter === 60);
    assert.deepEqual(urls, ["https://example.com/books"]);
  }
});

test("client forwards current login token but honors zero result-cache lifetime", async () => {
  let count = 0;
  const client = createBookClient({ endpoint: "https://example.com/books", publishableKey: "public", getAccessToken: async () => "user-token", fetcher: async (_, options) => {
    assert.equal(options.headers.Authorization, "Bearer user-token"); count++;
    return new Response('{"items":[],"cacheTtlSeconds":0}');
  } });
  await client.search({ query: "book" }); await client.search({ query: "book" }); assert.equal(count, 2);
});

test("guarded movie fallback preserves Wikidata entity and director lookup", async () => {
  const { rpc } = memoryRpc();
  const claim = id => [{ mainsnak: { datavalue: { value: { id } } } }];
  const handler = createCatalogHandler({ clientKey: "public", serviceKey: "internal", rpc, fetcher: async url => {
    let data;
    if (url.hostname === "itunes.apple.com") data = { results: [] };
    else if (url.searchParams.get("action") === "wbsearchentities") data = { search: [{ id: "Q13417189" }] };
    else if (url.searchParams.get("props") === "labels") data = { entities: { Q25191: { labels: { ja: { value: "クリストファー・ノーラン" } } } } };
    else data = { entities: { Q13417189: { id: "Q13417189", labels: { ja: { value: "インターステラー" } }, claims: { P31: claim("Q11424"), P57: claim("Q25191") } } } };
    return new Response(JSON.stringify(data), { headers: { "cache-control": "public, max-age=120" } });
  } });
  const response = await handler(request("インターステラー", { type: "movie" }));
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.items[0].creator, "クリストファー・ノーラン");
  assert.equal(result.cache.misses, 4);
});
