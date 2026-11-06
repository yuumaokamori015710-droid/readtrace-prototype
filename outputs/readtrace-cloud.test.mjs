import test from "node:test";
import assert from "node:assert/strict";
import { createCloudStore, recordFromRow, recordToRow, profileFor } from "./readtrace-cloud.mjs";
import { validateRecord } from "./readtrace-store.mjs";
const identity = { id: "11111111-1111-4111-8111-111111111111", user_metadata: { full_name: "読者 A", picture: "https://example.com/avatar.jpg" } };
const record = { work: { id: "book1", type: "book", title: "こころ", isbn: "4101010137" }, status: "done", rating: 4.5, review: "", spoiler: true, visibility: "private", startedAt: "2026-11-01", completedAt: "2026-11-03" };
function clientFixture() {
  const tables = Object.fromEntries(["profiles", "records", "settings", "follows", "likes", "comments"].map((name) => [`readtrace_${name}`, []]));
  const calls = []; let failWrites = false;
  const client = { from(table) {
    const filters = []; let operation = "select", body, single = false, range, limit;
    const builder = {
      select() { return builder; }, eq(key, value) { filters.push((row) => row[key] === value); return builder; }, neq(key, value) { filters.push((row) => row[key] !== value); return builder; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return builder; }, order() { return builder; }, range(start, end) { range = [start, end]; return builder; }, limit(value) { limit = value; return builder; },
      maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
      insert(value) { operation = "insert"; body = value; return builder; }, update(value) { operation = "update"; body = value; return builder; }, upsert(value) { operation = "upsert"; body = value; return builder; }, delete() { operation = "delete"; return builder; },
      then(resolve, reject) {
        calls.push({ table, operation });
        if (failWrites && operation !== "select") return Promise.resolve({ error: { code: "network" } }).then(resolve, reject);
        let rows = tables[table].filter((row) => filters.every((test) => test(row)));
        if (operation === "insert" || operation === "upsert") { const item = { id: crypto.randomUUID(), created_at: new Date().toISOString(), history: [], ...body }; tables[table].push(item); rows = [item]; }
        if (operation === "update") rows.forEach((row) => Object.assign(row, body));
        if (operation === "delete") tables[table] = tables[table].filter((row) => !rows.includes(row));
        if (range) rows = rows.slice(range[0], range[1] + 1); if (limit) rows = rows.slice(0, limit);
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    }; return builder;
  } };
  return { client, tables, calls, failWrites: () => { failWrites = true; } };
}
test("cloud row conversion preserves dates, ratings, spoiler/privacy and canonical ISBN", () => {
  const row = recordToRow(record, identity.id);
  assert.equal(row.work.isbn13, "9784101010137"); assert.equal(row.started_at, "2026-11-01");
  const restored = recordFromRow({ ...row, id: "saved", created_at: "2026-11-01T00:00:00Z" });
  assert.equal(restored.rating, 4.5); assert.equal(restored.spoiler, true); assert.equal(restored.visibility, "private"); assert.equal(restored.completedAt, record.completedAt);
});
test("profile contains name/avatar but never emails or authorization metadata", () => {
  assert.deepEqual(Object.keys(profileFor(identity)), ["id", "name", "avatar_url"]);
  assert.equal(profileFor({ ...identity, user_metadata: { picture: "javascript:alert(1)" } }).avatar_url, "");
});
test("real cloud save waits for server and survives loading a separate store", async () => {
  const fixture = clientFixture();
  const first = createCloudStore(fixture.client, identity); await first.init();
  const saved = await first.save(record, identity.id);
  assert.equal(first.data.records[0].id, saved.id);
  const second = createCloudStore(fixture.client, identity); await second.init();
  assert.equal(second.get(saved.id, identity.id).work.title, "こころ");
  assert.equal(second.get(saved.id, "someone-else"), undefined);
});
test("failed cloud writes do not claim success or change memory", async () => {
  const fixture = clientFixture(), store = createCloudStore(fixture.client, identity); await store.init(); fixture.failWrites();
  await assert.rejects(store.save(record, identity.id), /通信に失敗/); assert.equal(store.data.records.length, 0);
});
test("imports skip canonical duplicates and do not mutate the source", async () => {
  const fixture = clientFixture(), store = createCloudStore(fixture.client, identity); await store.init();
  const source = structuredClone(record);
  const result = await store.importRecords([source, { ...source, work: { ...source.work, id: "other-api", isbn: "9784101010137" } }]);
  assert.equal(result.imported, 1); assert.equal(result.skipped, 1); assert.deepEqual(source, record);
});
test("disposed stores and forged owners cannot write", async () => {
  const fixture = clientFixture(), store = createCloudStore(fixture.client, identity); await store.init();
  await assert.rejects(store.save(record, "forged-user"), /ログイン状態/);
  store.dispose(); assert.equal(store.data.records.length, 0);
  await assert.rejects(store.save(record, identity.id), /ログイン状態/);
});
test("impossible or reversed reading dates are rejected", () => {
  assert.match(validateRecord({ ...record, startedAt: "2026-02-30" }), /日付/);
  assert.match(validateRecord({ ...record, startedAt: "2026-11-05" }), /開始日/);
  assert.equal(validateRecord({ ...record, review: "" }), "");
});

test("untrusted public metadata is typed and active URLs are discarded", () => {
  const restored = recordFromRow({ work: { type: "book", title: "title", year: '<img src=x onerror=alert(1)>', image: "javascript:alert(1)", sourceUrl: "data:text/html,test", creator: {} }, rating: null });
  assert.equal(restored.work.year, null); assert.equal(restored.work.image, ""); assert.equal(restored.work.sourceUrl, ""); assert.equal(restored.work.creator, "");
});

test("remote deletion cannot be resurrected by saving a stale editor", async () => {
  const fixture = clientFixture(), store = createCloudStore(fixture.client, identity); await store.init();
  const saved = await store.save(record, identity.id);
  fixture.tables.readtrace_records.length = 0; await store.refresh();
  await assert.rejects(store.save(saved, identity.id), /別の端末で削除/);
  assert.equal(fixture.tables.readtrace_records.length, 0);
});

test("followed records are retained beyond the unrelated global activity window", async () => {
  const fixture = clientFixture();
  fixture.tables.readtrace_records.push(...Array.from({ length: 301 }, (_, i) => ({ id: `record${i}`, user_id: "unrelated", work: record.work, visibility: "public", status: "want", rating: null })));
  fixture.tables.readtrace_records.push({ id: "followed-record", user_id: "followed", work: record.work, visibility: "public", status: "want", rating: null });
  fixture.tables.readtrace_follows.push({ user_id: identity.id, target_id: "followed" });
  const store = createCloudStore(fixture.client, identity); await store.init();
  assert.ok(store.get("followed-record", identity.id));
});
