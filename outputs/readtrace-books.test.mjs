import test from "node:test";
import assert from "node:assert/strict";
import { canonicalIsbn, workIdentity, normalizeGoogle, normalizeOpenLibrary, normalizeNdl, normalizeMovie, mergeBooks, createBookProvider, createBookClient } from "./readtrace-books.mjs";
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const google = { id: "volume-1", volumeInfo: { title: "こころ", authors: ["夏目漱石"], industryIdentifiers: [{ identifier: "9784101010137" }], imageLinks: { thumbnail: "http://books.google.com/cover.jpg" }, publisher: "新潮社", publishedDate: "2004-03", description: "<p>心の物語</p>" } };
test("ISBN-10 and ISBN-13 use one validated canonical identity", () => {
  assert.equal(canonicalIsbn("4-10-101013-7"), "9784101010137");
  assert.equal(canonicalIsbn("978-4-10-101013-7"), "9784101010137");
  assert.equal(canonicalIsbn("9784101010138"), "");
  assert.equal(canonicalIsbn("not an ISBN"), "");
});
test("Google metadata includes real bibliographic fields and HTTPS covers", () => {
  const item = normalizeGoogle(google);
  assert.equal(item.publisher, "新潮社"); assert.equal(item.publishedAt, "2004-03");
  assert.equal(item.description, "心の物語"); assert.match(item.image, /^https:/);
});
test("cross-provider duplicates merge ISBN identity and fill missing fields", () => {
  const a = normalizeGoogle(google); a.description = "";
  const b = normalizeOpenLibrary({ key: "/works/OL123W", title: "こころ", isbn: ["4101010137"], author_name: ["夏目漱石"] }); b.description = "補完された概要";
  const result = mergeBooks([a], [b]);
  assert.equal(result.length, 1); assert.equal(result[0].description, b.description);
  assert.equal(workIdentity(a), workIdentity(b)); assert.match(result[0].source, /Open Library/);
});
test("missing image is empty rather than another book's cover", () => {
  assert.equal(normalizeGoogle({ id: "no-image", volumeInfo: { title: "書影なし" } }).image, "");
  assert.equal(normalizeNdl({ title: ["書影なし"], creator: ["著者"] }).image, "");
});
test("NDL handles both structured XML scalar and browser array values", () => {
  const item = normalizeNdl({ title: ["こころ"], creator: ["夏目漱石"], identifier: [{ "#text": "9784101010137" }], publisher: "新潮社" });
  assert.equal(item.title, "こころ"); assert.equal(item.creator, "夏目漱石"); assert.equal(item.isbn13, "9784101010137");
});
test("API failure falls back to Open Library, never sample data", async () => {
  const urls = [];
  const provider = createBookProvider({ fetcher: async (url) => {
    urls.push(String(url));
    return String(url).includes("googleapis") ? response({}, 429) : response({ numFound: 40, docs: [{ key: "/works/OL1W", title: "Kokoro", author_name: ["Natsume Soseki"] }] });
  } });
  const result = await provider.search({ query: "Soseki", page: 2, field: "author" });
  assert.equal(result.items[0].title, "Kokoro"); assert.equal(result.hasMore, true);
  assert.equal(result.warnings.length, 1); assert.match(urls[0], /inauthor/); assert.match(urls[1], /page=2/);
});
test("zero results are distinct from total service failure", async () => {
  const empty = createBookProvider({ fetcher: async () => response({ totalItems: 0, numFound: 0, docs: [] }) });
  assert.deepEqual((await empty.search({ query: "不存在" })).items, []);
  const failed = createBookProvider({ fetcher: async () => response({}, 503) });
  await assert.rejects(failed.search({ query: "不存在" }), /接続できません/);
});
test("queries are cached and invalid ISBN is rejected before network access", async () => {
  let count = 0;
  const provider = createBookProvider({ fetcher: async () => { count++; return response({ items: [google], docs: [] }); } });
  await provider.search({ query: "こころ" }); await provider.search({ query: "こころ" });
  assert.equal(count, 2);
  await assert.rejects(provider.search({ query: "123", field: "isbn" }), /ISBN/); assert.equal(count, 2);
});
test("public client sends no private Google key and preserves proxy results", async () => {
  let request;
  const client = createBookClient({ endpoint: "https://example.com/books", publishableKey: "public-project-id", fetcher: async (url, options) => { request = options; return response({ items: [normalizeGoogle(google)], hasMore: false, sources: ["Google Books"], warnings: [] }); } });
  assert.equal((await client.search({ query: "こころ" })).items.length, 1);
  assert.equal(request.headers.apikey, "public-project-id"); assert.equal(request.body.includes("key"), false);
});
test("movie lookup uses real Japanese store metadata and no promotional artwork", async () => {
  const fixture = { trackId: 123, trackName: "インターステラー", artistName: "クリストファー・ノーラン", releaseDate: "2014-11-22T00:00:00Z", artworkUrl100: "https://example.com/art.jpg", trackViewUrl: "https://tv.apple.com/movie/example" };
  const normalized = normalizeMovie(fixture); assert.equal(normalized.type, "movie"); assert.equal(normalized.image, "");
  let url;
  const provider = createBookProvider({ fetcher: async (value) => { url = value; return response({ results: [fixture] }); } });
  const result = await provider.movies({ query: "インターステラー" });
  assert.equal(result.items[0].title, fixture.trackName); assert.match(String(url), /country=jp/); assert.match(String(url), /entity=movie/);
});

test("movie fallback excludes similarly named missions and resolves director labels", async () => {
  const claims = (id) => [{ mainsnak: { datavalue: { value: { id } } } }];
  const provider = createBookProvider({ fetcher: async (url, options) => {
    if (url.hostname === "itunes.apple.com") return response({ results: [] });
    assert.match(options.headers["Api-User-Agent"], /ReadTrace/);
    if (url.searchParams.get("action") === "wbsearchentities") return response({ search: [{ id: "Q13417189" }, { id: "Q999" }] });
    if (url.searchParams.get("props") === "labels") return response({ entities: { Q25191: { labels: { ja: { value: "クリストファー・ノーラン" } } } } });
    return response({ entities: { Q13417189: { id: "Q13417189", labels: { ja: { value: "インターステラー" } }, claims: { P31: claims("Q11424"), P57: claims("Q25191") } }, Q999: { id: "Q999", labels: { ja: { value: "宇宙探査" } }, claims: { P31: claims("Q000") } } } });
  } });
  const result = await provider.movies({ query: "インターステラー" });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].creator, "クリストファー・ノーラン"); assert.deepEqual(result.sources, ["Wikidata"]);
});

test("concurrent Open Library searches reserve serial request slots", async () => {
  let active = 0, peak = 0;
  const provider = createBookProvider({ pause: async () => {}, fetcher: async (url) => {
    if (url.hostname.includes("googleapis")) return response({}, 429);
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10)); active--;
    return response({ docs: [], numFound: 0 });
  } });
  await Promise.all(["one", "two", "three"].map((query) => provider.search({ query })));
  assert.equal(peak, 1);
});
