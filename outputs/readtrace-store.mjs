import { seedData } from "./readtrace-data.mjs";
import { workIdentity } from "./readtrace-books.mjs";
export const STORAGE_KEY = "readtrace:books-films:v2";
export const SESSION_KEY = "readtrace:demo-session:v2";
export const labels = {
  book: { want: "読みたい", reading: "読書中", done: "読了" },
  movie: { want: "観たい", watching: "鑑賞中", done: "鑑賞済み" },
};
export const visibleTo = (record, userId) =>
  Boolean(
    userId && (record.visibility === "public" || record.userId === userId),
  );
export const socialRecord = (record) =>
  record?.visibility === "public" && record.status === "done";
export function validateRecord(record) {
  if (!["book", "movie"].includes(record.work?.type))
    return "作品の種別を選んでください。";
  if (!record.work?.title?.trim()) return "タイトルを入力してください。";
  if (!Object.keys(labels[record.work.type]).includes(record.status))
    return "状態を選んでください。";
  if (
    record.rating !== null &&
    (!Number.isFinite(record.rating) ||
      record.rating < 0.5 ||
      record.rating > 5 ||
      (record.rating * 2) % 1 !== 0)
  )
    return "評価は0.5〜5の範囲で選んでください。";
  if (record.status === "done" && record.rating === null)
    return "読了・鑑賞済みの記録には評価を選んでください。";
  for (const value of [record.startedAt, record.completedAt]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return "日付を確認してください。";
  }
  if (record.startedAt && record.completedAt && record.startedAt > record.completedAt) return "開始日は完了日以前にしてください。";
  if (!["public", "private"].includes(record.visibility))
    return "公開範囲を選んでください。";
  return "";
}
export function createStore(storage, { key = STORAGE_KEY, seed = seedData } = {}) {
  let data;
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (
      saved?.version === 2 &&
      Array.isArray(saved.users) &&
      Array.isArray(saved.records)
    )
      data = saved;
  } catch {}
  data ||= seed();
  const persist = () => storage.setItem(key, JSON.stringify(data));
  const visible = (viewer, owner) =>
    data.records.filter(
      (r) => visibleTo(r, viewer) && (!owner || r.userId === owner),
    );
  const get = (id, viewer) =>
    data.records.find((r) => r.id === id && visibleTo(r, viewer));
  const requireUser = (id) => {
    if (!data.users.some((u) => u.id === id))
      throw new Error("ログインしてください。");
  };
  return {
    get data() {
      return data;
    },
    visible,
    get,
    save(record, viewer) {
      requireUser(viewer);
      const existing = data.records.find((r) => r.id === record.id);
      if (existing && existing.userId !== viewer)
        throw new Error("この記録は編集できません。");
      const error = validateRecord(record);
      if (error) throw new Error(error);
      if (
        record.work.id &&
        data.records.some(
          (r) => r.id !== existing?.id && r.userId === viewer && workIdentity(r.work) === workIdentity(record.work),
        )
      )
        throw new Error("この作品はすでに棚にあります。");
      const item = {
        ...record,
        id: existing?.id || crypto.randomUUID(),
        userId: viewer,
        work: { ...record.work, title: record.work.title.trim() },
        createdAt: existing?.createdAt || new Date().toISOString(),
        history: [...(existing?.history || []), ...(!existing || existing.status !== record.status ? [{ status: record.status, rating: record.rating, at: new Date().toISOString() }] : [])],
      };
      data.records = existing
        ? data.records.map((r) => (r.id === item.id ? item : r))
        : [item, ...data.records];
      persist();
      return item;
    },
    remove(id, viewer) {
      if (!data.records.some((r) => r.id === id && r.userId === viewer))
        throw new Error("この記録は削除できません。");
      data.records = data.records.filter((r) => r.id !== id);
      data.likes = data.likes.filter(([, r]) => r !== id);
      data.comments = data.comments.filter((c) => c.recordId !== id);
      persist();
    },
    follow(viewer, target) {
      requireUser(viewer);
      if (viewer === target || !data.users.some((u) => u.id === target)) return;
      const found = data.follows.some(([a, b]) => a === viewer && b === target);
      data.follows = found
        ? data.follows.filter(([a, b]) => !(a === viewer && b === target))
        : [...data.follows, [viewer, target]];
      persist();
    },
    like(viewer, id) {
      requireUser(viewer);
      if (!socialRecord(get(id, viewer)))
        throw new Error("公開された完了記録にのみ、いいねできます。");
      const found = data.likes.some(([a, b]) => a === viewer && b === id);
      data.likes = found
        ? data.likes.filter(([a, b]) => !(a === viewer && b === id))
        : [...data.likes, [viewer, id]];
      persist();
    },
    comment(viewer, id, text) {
      requireUser(viewer);
      if (!socialRecord(get(id, viewer)))
        throw new Error("公開された完了記録にのみ、コメントできます。");
      if (!text.trim()) throw new Error("コメントを入力してください。");
      if (text.length > 1000)
        throw new Error("コメントは1,000文字以内で入力してください。");
      data.comments.push({
        id: crypto.randomUUID(),
        recordId: id,
        userId: viewer,
        text: text.trim(),
        createdAt: new Date().toISOString(),
      });
      persist();
    },
    removeComment(viewer, id) {
      if (!data.comments.some((c) => c.id === id && c.userId === viewer))
        throw new Error("自分のコメントのみ削除できます。");
      data.comments = data.comments.filter((c) => c.id !== id);
      persist();
    },
    register(name) {
      if (!name.trim()) throw new Error("表示名を入力してください。");
      const user = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 30),
        bio: "",
        initial: name.trim()[0],
        color: "#536e60",
      };
      data.users.push(user);
      data.goals[user.id] = 5;
      persist();
      return user;
    },
    goal(viewer, goal) {
      requireUser(viewer);
      if (!Number.isInteger(goal) || goal < 1 || goal > 99)
        throw new Error("目標は1〜99冊で設定してください。");
      data.goals[viewer] = goal;
      persist();
    },
    persist,
  };
}
