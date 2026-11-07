import test from "node:test";
import assert from "node:assert/strict";
import { impressionLength, impressionError, ratingSummary, completionLabel, localDate, impressionState } from "./readtrace-record.mjs";
import { createStore, validateRecord } from "./readtrace-store.mjs";

const draft = { work: { id: "fixture", type: "movie", title: "記録テスト" }, status: "done", rating: null, visibility: "private", review: "詳しい感想", impression: "余韻が残った" };
test("20 graphemes accepts Japanese combining marks, flags and emoji families without truncating", () => {
  const text = "か\u3099👨‍👩‍👧‍👦🇯🇵👍🏽".repeat(5);
  assert.equal(impressionLength(text), 20);
  assert.equal(impressionError(text, true), "");
  assert.match(impressionError(text + "あ", true), /20文字/);
  assert.match(impressionError("　 \t", true), /入力/);
  assert.match(impressionError("改\n行", true), /1行/);
});
test("averages exclude missing axes, preserve the legacy score, and accept every half point", () => {
  assert.deepEqual(ratingSummary({ rating: 4.5 }), { count: 0, average: null, legacy: 4.5 });
  assert.deepEqual(ratingSummary({ rating: 3, axisRatings: { immersion: 0.5, afterglow: 5 } }), { count: 2, average: 2.75, legacy: 3 });
  assert.deepEqual(ratingSummary({ axisRatings: { immersion: 5, originality: 3.5, structure: 3, expression: 4.5, afterglow: 5 } }), { count: 5, average: 4.2, legacy: null });
  assert.match(validateRecord({ ...draft, axisRatings: { unknown: 5 } }), /評価/);
});
test("calendar dates and unknown completion never fall back to created time", () => {
  assert.equal(localDate(new Date(2026, 10, 7, 23, 59)), "2026-11-07");
  assert.equal(completionLabel({ ...draft, completedAt: "2024-02-29" }), "2024.02.29 鑑賞");
  assert.equal(completionLabel({ ...draft, createdAt: "2026-11-07T00:00:00Z" }), "鑑賞日不明");
  assert.equal(completionLabel({ ...draft, status: "want", completedAt: "2024-02-29" }), "");
});
test("unrevealed spoiler state never carries impression text", () => {
  assert.deepEqual(impressionState({ ...draft, spoiler: true }), { kind: "spoiler" });
  assert.deepEqual(impressionState({ ...draft, spoiler: true }, true), { kind: "text", text: draft.impression });
});
test("legacy edit, status transition, and reload preserve private records and notes", () => {
  let json;
  const storage = { getItem: () => json, setItem: (_, value) => { json = value; } };
  const store = createStore(storage);
  const original = store.get("r1", "shiori");
  assert.ok(original.rating > 0);
  const legacy = store.save({ ...original, visibility: "private" }, "shiori");
  assert.equal(legacy.impression, null);
  assert.equal(legacy.review, original.review);
  assert.equal(legacy.rating, original.rating);
  assert.deepEqual(legacy.axisRatings, {});
  const want = store.save({ ...draft, status: "want", impression: null }, "shiori");
  assert.throws(() => store.save({ ...want, status: "done" }, "shiori"), /一言/);
  const done = store.save({ ...want, ...draft, completedAt: "2024-02-29", axisRatings: { afterglow: 4.5 } }, "shiori");
  const restored = createStore(storage);
  assert.equal(restored.get(done.id, "haru"), undefined);
  assert.deepEqual(restored.get(done.id, "shiori"), done);
  assert.equal(done.createdAt, want.createdAt);
});
test("local persistence failures roll back in-memory record changes", () => {
  const store = createStore({ getItem: () => null, setItem: () => { throw new Error("storage full"); } });
  const before = store.data.records.length;
  assert.throws(() => store.save(draft, "shiori"), /storage full/);
  assert.equal(store.data.records.length, before);
});
