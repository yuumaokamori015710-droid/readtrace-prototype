import test from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  STORAGE_KEY,
  visibleTo,
  socialRecord,
  validateRecord,
} from "./readtrace-store.mjs";
import { catalog } from "./readtrace-data.mjs";
function fixture() {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
  };
  return { storage, store: createStore(storage) };
}
const draft = (type = "book") => ({
  work: {
    id: "custom-work",
    type,
    title: "手入力テスト",
    creator: "",
    image: "",
  },
  status: "want",
  rating: null,
  review: "",
  spoiler: false,
  visibility: "public",
  completedAt: "",
});
test("検索用の本と映画は各30作品で、検索成功と不一致を再現できる", () => {
  for (const type of ["book", "movie"])
    assert.equal(catalog.filter((w) => w.type === type).length, 30);
  assert.ok(catalog.find((w) => w.title.includes("インターステラー")));
  assert.equal(
    catalog.filter((w) => w.title.includes("絶対に存在しない検索語")).length,
    0,
  );
});
test("未ログインでは公開記録を含めて閲覧できない", () => {
  const { store } = fixture();
  assert.equal(store.visible("").length, 0);
  assert.equal(store.get("r1", ""), undefined);
});
test("非公開記録は本人の棚にのみ存在し、別ユーザーの棚・詳細から除外される", () => {
  const { store } = fixture();
  assert.equal(store.get("r8", "shiori").visibility, "private");
  assert.equal(store.get("r8", "haru"), undefined);
  assert.ok(!store.visible("haru", "shiori").some((r) => r.id === "r8"));
  assert.ok(!store.visible("shiori", "haru").some((r) => r.id === "r18"));
  assert.equal(visibleTo(store.get("r8", "shiori"), "kenta"), false);
});
test("完了時は一言が必要だが、評価・長文・完了日は任意", () => {
  const { store } = fixture();
  const r = { ...draft(), status: "done" };
  assert.throws(() => store.save(r, "shiori"), /一言/);
  const saved = store.save({ ...r, impression: "面白かった" }, "shiori");
  assert.equal(saved.rating, null);
  assert.deepEqual(saved.axisRatings, {});
  assert.equal(saved.review, "");
  assert.equal(saved.completedAt, "");
});
test("本・映画とも5軸は0.5刻みの全評価を受け入れ、それ以外を拒否する", () => {
  for (const type of ["book", "movie"]) {
    for (let rating = 0.5; rating <= 5; rating += 0.5)
      assert.equal(
        validateRecord({ ...draft(type), status: "done", impression: "余韻", axisRatings: { immersion: rating } }),
        "",
      );
    for (const rating of [0, -1, 5.5, 2.2, NaN, Infinity])
      assert.match(
        validateRecord({ ...draft(type), status: "done", impression: "余韻", axisRatings: { immersion: rating } }),
        /評価/,
      );
  }
});
test("映画の鑑賞中・本の読書中は未評価で保存でき、状態不一致を拒否する", () => {
  assert.equal(validateRecord({ ...draft("movie"), status: "watching" }), "");
  assert.equal(validateRecord({ ...draft(), status: "reading" }), "");
  assert.match(
    validateRecord({ ...draft("movie"), status: "reading" }),
    /状態/,
  );
});
test("手入力に種別とタイトルが必要で、画像や著者は不要", () => {
  assert.match(
    validateRecord({ ...draft(), work: { type: "book", title: "" } }),
    /タイトル/,
  );
  assert.match(validateRecord({ ...draft(), work: { title: "本" } }), /種別/);
  assert.equal(validateRecord(draft()), "");
});
test("自分の記録の編集・削除と、所有者以外の操作の拒否", () => {
  const { store } = fixture();
  const r = store.save(draft(), "shiori");
  assert.throws(() => store.save({ ...r, review: "変更" }, "haru"), /編集/);
  assert.throws(() => store.remove(r.id, "haru"), /削除/);
  store.save(
    {
      ...r,
      status: "done",
      axisRatings: { immersion: 4.5 },
      impression: "続きが気になる",
      visibility: "private",
      spoiler: true,
      review: "個人メモ",
    },
    "shiori",
  );
  assert.equal(store.get(r.id, "shiori").axisRatings.immersion, 4.5);
  assert.equal(store.get(r.id, "haru"), undefined);
  store.remove(r.id, "shiori");
  assert.equal(store.get(r.id, "shiori"), undefined);
});
test("二重登録を拒否する", () => {
  const { store } = fixture();
  assert.throws(
    () => store.save({ ...draft(), work: catalog[0] }, "shiori"),
    /すでに/,
  );
});
test("フォローといいねの切り替えが保存される", () => {
  const { store, storage } = fixture();
  store.follow("kenta", "haru");
  assert.ok(store.data.follows.some(([a, b]) => a === "kenta" && b === "haru"));
  store.follow("kenta", "haru");
  assert.ok(
    !store.data.follows.some(([a, b]) => a === "kenta" && b === "haru"),
  );
  store.like("shiori", "r19");
  assert.ok(
    createStore(storage).data.likes.some(
      ([a, b]) => a === "shiori" && b === "r19",
    ),
  );
  store.like("shiori", "r19");
  assert.ok(!store.data.likes.some(([a, b]) => a === "shiori" && b === "r19"));
});
test("公開された完了記録にのみ交流ができる", () => {
  const { store } = fixture();
  assert.equal(socialRecord(store.get("r8", "shiori")), false);
  assert.throws(() => store.like("shiori", "r8"), /公開/);
  assert.throws(() => store.comment("shiori", "r8", "コメント"), /公開/);
  assert.throws(() => store.like("shiori", "r3"), /公開/);
  assert.throws(() => store.like("", "r1"), /ログイン/);
});
test("コメントの投稿・空文字の拒否・自分のコメントのみ削除", () => {
  const { store } = fixture();
  assert.throws(() => store.comment("shiori", "r13", "  "), /入力/);
  store.comment("shiori", "r13", "  いい作品でした  ");
  const c = store.data.comments.at(-1);
  assert.equal(c.text, "いい作品でした");
  assert.throws(() => store.removeComment("haru", c.id), /自分/);
  store.removeComment("shiori", c.id);
  assert.ok(!store.data.comments.some((x) => x.id === c.id));
});
test("新規登録は空の棚で開始し、設定・記録・交流はストレージから復元できる", () => {
  const { store, storage } = fixture();
  const u = store.register("テスト読者");
  assert.equal(store.visible(u.id, u.id).length, 0);
  store.goal(u.id, 8);
  store.save(draft("movie"), u.id);
  store.follow(u.id, "haru");
  store.like(u.id, "r13");
  store.comment(u.id, "r13", "また読みたい");
  const restored = createStore(storage);
  assert.equal(restored.data.goals[u.id], 8);
  assert.equal(restored.visible(u.id, u.id).length, 1);
  assert.ok(restored.data.comments.some((c) => c.userId === u.id));
  assert.ok(storage.getItem(STORAGE_KEY));
});
test("壊れた保存データでも起動できる", () => {
  const store = createStore({ getItem: () => "{bad json", setItem: () => {} });
  assert.equal(store.data.users.length, 3);
});
