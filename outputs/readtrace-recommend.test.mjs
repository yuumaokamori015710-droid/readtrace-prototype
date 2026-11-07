import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "./readtrace-data.mjs";
import { sameWork, rankRecommendations, recommendationQuery } from "./readtrace-recommend.mjs";

const find = id => catalog.find(work => work.id === id);
const record = (id, rating, status = "done") => ({ work: find(id), rating, status, review: "private review marker" });
const ranked = (type, records, extras = {}) => rankRecommendations({ type, records, catalog, ...extras });
test("cold start is deterministic, media-specific, diverse, and does not mutate records", () => {
  for (const type of ["book", "movie"]) {
    const records = [];
    const one = ranked(type, records), two = ranked(type, records);
    assert.deepEqual(one, two);
    assert.equal(one.length, 30);
    assert.equal(new Set(one.slice(0, 3).map(x => x.genre)).size, 3);
    assert.ok(one.every(x => x.work.type === type && !x.saved && !x.reason.includes("高評価")));
    assert.equal(records.length, 0);
  }
});
test("high-rated book and movie histories change results using actual matching features", () => {
  assert.equal(ranked("book", [record("b21", 5)])[0].work.id, "b29");
  assert.equal(ranked("book", [record("b14", 5)])[0].work.id, "b15");
  assert.equal(ranked("movie", [record("m3", 5)])[0].work.id, "m28");
  assert.equal(ranked("movie", [record("m6", 5)])[0].work.creator, "宮﨑駿");
  assert.match(ranked("movie", [record("m3", 5)])[0].reason, /高評価.*監督/);
});
test("low scores are not positive, wants are weak, and media histories do not cross", () => {
  const sf = ranked("movie", [record("m3", 1), record("m6", null, "want")]);
  assert.ok(sf.find(x => x.work.id === "m28").score < 0);
  assert.ok(!sf.find(x => x.work.id === "m28").reason.includes("高評価"));
  assert.deepEqual(ranked("movie", [record("b21", 5)]), ranked("movie", []));
  assert.equal(recommendationQuery("movie", [record("m3", 5)], catalog), "メッセージ");
  assert.ok(!recommendationQuery("book", [record("b21", 5)], catalog).includes("private review"));
});
test("provider duplicates and all previously registered works are excluded", () => {
  const api = { ...find("b1"), id: "ndl:example", isbn13: find("b1").isbn };
  assert.equal(sameWork(api, find("b1")), true);
  assert.equal(ranked("book", [record("b1", 5), record("b2", null, "want")], { fetched: [api] }).length, 28);
  assert.equal(sameWork(find("m3"), { ...find("m3"), id: "another-film", year: 2019 }), false);
  const added = [find("b2")];
  assert.equal(ranked("book", [record("b2", null, "want")], { added }).find(x => x.work.id === "b2").saved, true);
});
