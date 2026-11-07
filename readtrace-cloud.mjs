import { validateRecord, visibleTo, socialRecord } from "./readtrace-store.mjs?v=shelf-notes-1";
import { canonicalIsbn, safeImage, workIdentity } from "./readtrace-books.mjs";
import { readAxes } from "./readtrace-record.mjs";

export function profileFor(identity) {
  const name = String(identity.user_metadata?.full_name || identity.user_metadata?.name || "読書家").trim().slice(0, 60) || "読書家";
  return { id: identity.id, name, avatar_url: safeImage(identity.user_metadata?.avatar_url || identity.user_metadata?.picture) };
}
export function recordFromRow(row) {
  const source = row.work || {}, work = { type: source.type === "movie" ? "movie" : "book" };
  for (const key of ["id", "title", "creator", "isbn", "isbn13", "publisher", "publishedAt", "description", "genre", "language", "source"]) work[key] = typeof source[key] === "string" ? source[key] : "";
  work.image = safeImage(source.image); work.sourceUrl = safeImage(source.sourceUrl);
  work.year = Number.isInteger(source.year) && source.year > 0 && source.year < 10000 ? source.year : null;
  return { id: row.id, userId: row.user_id, work, status: row.status, rating: row.rating == null ? null : Number(row.rating), impression: typeof row.impression === "string" ? row.impression : null, axisRatings: readAxes(row.axis_ratings), review: row.review || "", spoiler: row.spoiler, visibility: row.visibility, startedAt: row.started_at || "", completedAt: row.completed_at || "", history: row.history || [], createdAt: row.created_at, updatedAt: row.updated_at };
}
export function recordToRow(record, userId) {
  const work = { ...record.work };
  if (work.type === "book") { const isbn = canonicalIsbn(work.isbn13 || work.isbn); work.isbn13 = isbn; work.isbn = isbn; }
  return { user_id: userId, work, status: record.status, rating: record.rating ?? null, impression: record.impression?.trim() || null, axis_ratings: readAxes(record.axisRatings), review: record.review || "", spoiler: Boolean(record.spoiler), visibility: record.visibility, started_at: record.startedAt || null, completed_at: record.completedAt || null };
}
export function cloudError(error) {
  if (error?.code === "23505") return new Error("この作品はすでに棚にあります。");
  if (error?.code === "42501" || error?.status === 401) return new Error("この操作は許可されていません。ログイン状態を確認してください。");
  if (error?.code === "23514" || error?.code === "22007" || error?.code === "22008") return new Error("評価・日付・タイトルなどの入力内容を確認してください。");
  return new Error("クラウドとの通信に失敗しました。変更は確定していません。接続を確認して再試行してください。");
}
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
async function unwrap(query) { const result = await query; if (result.error) throw cloudError(result.error); return result.data; }
async function allRows(queryForPage) {
  const result = [];
  for (let start = 0; ; start += 500) {
    const rows = await unwrap(queryForPage().range(start, start + 499));
    result.push(...rows);
    if (rows.length < 500) return result;
  }
}

export function createCloudStore(client, identity, { onChange = () => {}, onSync = () => {} } = {}) {
  let data = { version: 2, users: [], records: [], follows: [], likes: [], comments: [], goals: {} };
  let disposed = false, channel, timer, refreshPromise, refreshAgain = false;
  const ownId = identity.id;
  const assertOwner = (viewer) => { if (disposed || viewer !== ownId) throw new Error("ログイン状態が変わりました。再度操作してください。"); };
  const emit = () => { if (!disposed) onChange(); };
  const visible = (viewer, owner) => data.records.filter((r) => visibleTo(r, viewer) && (!owner || r.userId === owner));
  const get = (id, viewer) => data.records.find((r) => r.id === id && visibleTo(r, viewer));
  async function related(records) {
    const likes = [], comments = [];
    const ids = records.filter(socialRecord).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      likes.push(...await allRows(() => client.from("readtrace_likes").select("user_id,record_id").in("record_id", chunk).order("record_id").order("user_id")));
      comments.push(...await allRows(() => client.from("readtrace_comments").select("id,user_id,record_id,text,created_at").in("record_id", chunk).order("created_at").order("id")));
    }
    return { likes: likes.map((r) => [r.user_id, r.record_id]), comments: comments.map((r) => ({ id: r.id, userId: r.user_id, recordId: r.record_id, text: r.text, createdAt: r.created_at })) };
  }
  async function refresh() {
    if (disposed) return;
    if (refreshPromise) { refreshAgain = true; return refreshPromise; }
    refreshPromise = (async () => {
      do {
        refreshAgain = false; onSync("syncing");
        const own = await allRows(() => client.from("readtrace_records").select("*").eq("user_id", ownId).order("created_at", { ascending: false }).order("id"));
        const publicRows = await unwrap(client.from("readtrace_records").select("*").eq("visibility", "public").neq("user_id", ownId).order("created_at", { ascending: false }).limit(300));
        const profiles = await allRows(() => client.from("readtrace_profiles").select("id,name,bio,avatar_url").order("id"));
        const follows = await allRows(() => client.from("readtrace_follows").select("user_id,target_id").order("user_id").order("target_id"));
        const followed = follows.filter((r) => r.user_id === ownId).map((r) => r.target_id);
        const followedRows = [];
        for (let i = 0; i < followed.length; i += 100) followedRows.push(...await allRows(() => client.from("readtrace_records").select("*").eq("visibility", "public").in("user_id", followed.slice(i, i + 100)).order("created_at", { ascending: false }).order("id")));
        const settings = await unwrap(client.from("readtrace_settings").select("monthly_goal").eq("user_id", ownId).maybeSingle());
        const records = [...new Map([...own, ...publicRows, ...followedRows].map((r) => [r.id, r])).values()].map(recordFromRow);
        const social = await related(records);
        if (disposed) return;
        data = { version: 2, users: profiles.map((p) => ({ id: p.id, name: p.name, bio: p.bio, avatarUrl: safeImage(p.avatar_url), initial: Array.from(p.name)[0], color: "#536e60" })), records, follows: follows.map((r) => [r.user_id, r.target_id]), ...social, goals: { [ownId]: settings?.monthly_goal || 5 } };
        onSync("ready"); emit();
      } while (refreshAgain && !disposed);
    })().catch((error) => { if (!disposed) onSync("error"); throw error; }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  const store = {
    mode: "cloud",
    get data() { return data; }, visible, get, refresh,
    async init() {
      const existing = await unwrap(client.from("readtrace_profiles").select("id").eq("id", ownId).maybeSingle());
      if (!existing) {
        const result = await client.from("readtrace_profiles").insert(profileFor(identity));
        if (result.error && result.error.code !== "23505") throw cloudError(result.error);
      } else await unwrap(client.from("readtrace_profiles").update(profileFor(identity)).eq("id", ownId));
      await refresh();
      return store;
    },
    async ensureRoute(path) {
      const parts = path.split("/");
      const target = parts[2];
      if (!["user", "share", "record"].includes(parts[1]) || !uuid(target)) return;
      let records;
      if (parts[1] === "record") {
        const row = await unwrap(client.from("readtrace_records").select("*").eq("id", target).maybeSingle());
        records = row ? [recordFromRow(row)] : [];
        if (!row) data.records = data.records.filter((r) => r.id !== target);
      } else records = (await allRows(() => client.from("readtrace_records").select("*").eq("user_id", target).order("created_at", { ascending: false }).order("id"))).map(recordFromRow);
      if (disposed) return;
      const ids = new Set(records.map((r) => r.id));
      const owners = new Set(records.map((r) => r.userId));
      if (parts[1] !== "record") owners.add(target);
      const profiles = await unwrap(client.from("readtrace_profiles").select("id,name,bio,avatar_url").in("id", [...owners]));
      const social = await related(records);
      if (disposed) return;
      data.records = [...data.records.filter((r) => !ids.has(r.id) && !(parts[1] !== "record" && r.userId === target)), ...records];
      data.users = [...data.users.filter((u) => !owners.has(u.id)), ...profiles.map((p) => ({ id: p.id, name: p.name, bio: p.bio, avatarUrl: safeImage(p.avatar_url), initial: Array.from(p.name)[0], color: "#536e60" }))];
      data.likes = [...data.likes.filter(([, id]) => !ids.has(id)), ...social.likes];
      data.comments = [...data.comments.filter((c) => !ids.has(c.recordId)), ...social.comments];
    },
    async save(record, viewer, { preserveLegacy = false } = {}) {
      assertOwner(viewer);
      const existing = data.records.find((r) => r.id === record.id);
      const error = validateRecord(record, { previous: existing, preserveLegacy }); if (error) throw new Error(error);
      if (record.id && !existing) throw new Error("この記録は別の端末で削除されたか、読み込めなくなりました。棚を更新してください。");
      if (existing && existing.userId !== viewer) throw new Error("この記録は編集できません。");
      if (!existing && data.records.some((r) => r.userId === viewer && workIdentity(r.work) === workIdentity(record.work))) throw new Error("この作品はすでに棚にあります。");
      const payload = recordToRow(record, ownId);
      const query = existing ? client.from("readtrace_records").update(payload).eq("id", existing.id).eq("user_id", ownId) : client.from("readtrace_records").insert({ ...payload, ...(record.createdAt ? { created_at: record.createdAt } : {}), history: Array.isArray(record.history) ? record.history : [] });
      const row = await unwrap(query.select("*").maybeSingle());
      assertOwner(viewer);
      if (!row) throw new Error("この記録は別の端末で削除されました。棚を更新してください。");
      const saved = recordFromRow(row);
      if (!disposed) { data.records = [saved, ...data.records.filter((r) => r.id !== saved.id)]; emit(); }
      return saved;
    },
    async remove(id, viewer) {
      assertOwner(viewer); if (get(id, viewer)?.userId !== viewer) throw new Error("この記録は削除できません。");
      await unwrap(client.from("readtrace_records").delete().eq("id", id).eq("user_id", ownId));
      if (!disposed) { data.records = data.records.filter((r) => r.id !== id); data.likes = data.likes.filter(([, r]) => r !== id); data.comments = data.comments.filter((c) => c.recordId !== id); emit(); }
    },
    async follow(viewer, target) {
      assertOwner(viewer); if (target === viewer) return;
      const found = data.follows.some(([a, b]) => a === viewer && b === target);
      await unwrap(found ? client.from("readtrace_follows").delete().eq("user_id", ownId).eq("target_id", target) : client.from("readtrace_follows").insert({ user_id: ownId, target_id: target }));
      if (!disposed) { data.follows = found ? data.follows.filter(([a, b]) => !(a === viewer && b === target)) : [...data.follows, [viewer, target]]; emit(); }
    },
    async like(viewer, id) {
      assertOwner(viewer); if (!socialRecord(get(id, viewer))) throw new Error("公開された完了記録にのみ、いいねできます。");
      const found = data.likes.some(([a, b]) => a === viewer && b === id);
      await unwrap(found ? client.from("readtrace_likes").delete().eq("user_id", ownId).eq("record_id", id) : client.from("readtrace_likes").insert({ user_id: ownId, record_id: id }));
      if (!disposed) { data.likes = found ? data.likes.filter(([a, b]) => !(a === viewer && b === id)) : [...data.likes, [viewer, id]]; emit(); }
    },
    async comment(viewer, id, text) {
      assertOwner(viewer); if (!socialRecord(get(id, viewer))) throw new Error("公開された完了記録にのみ、コメントできます。");
      if (!text.trim() || text.length > 1000) throw new Error("コメントは1〜1,000文字で入力してください。");
      const row = await unwrap(client.from("readtrace_comments").insert({ user_id: ownId, record_id: id, text: text.trim() }).select("*").single());
      if (!disposed) { data.comments.push({ id: row.id, userId: ownId, recordId: id, text: row.text, createdAt: row.created_at }); emit(); }
    },
    async removeComment(viewer, id) {
      assertOwner(viewer); if (!data.comments.some((c) => c.id === id && c.userId === viewer)) throw new Error("自分のコメントのみ削除できます。");
      await unwrap(client.from("readtrace_comments").delete().eq("id", id).eq("user_id", ownId));
      if (!disposed) { data.comments = data.comments.filter((c) => c.id !== id); emit(); }
    },
    async goal(viewer, goal) {
      assertOwner(viewer); if (!Number.isInteger(goal) || goal < 1 || goal > 99) throw new Error("目標は1〜99冊で設定してください。");
      await unwrap(client.from("readtrace_settings").upsert({ user_id: ownId, monthly_goal: goal }, { onConflict: "user_id" }));
      if (!disposed) { data.goals[ownId] = goal; emit(); }
    },
    async importRecords(records) {
      let imported = 0, skipped = 0;
      const errors = [];
      for (const record of records) {
        if (data.records.some((r) => r.userId === ownId && workIdentity(r.work) === workIdentity(record.work))) { skipped++; continue; }
        try { await store.save({ ...record, id: undefined }, ownId, { preserveLegacy: true }); imported++; }
        catch (error) { errors.push(`${record.work?.title || "作品"}: ${error.message}`); }
      }
      return { imported, skipped, errors };
    },
    subscribe() {
      const changed = () => { clearTimeout(timer); timer = setTimeout(() => refresh().catch(() => {}), 300); };
      channel = client.channel(`readtrace:${ownId}`);
      for (const table of ["readtrace_profiles", "readtrace_records", "readtrace_settings", "readtrace_follows", "readtrace_likes", "readtrace_comments"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, changed);
      channel.subscribe((status) => { if (status === "SUBSCRIBED") changed(); else if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) onSync("error"); });
    },
    dispose() { disposed = true; clearTimeout(timer); if (channel) void client.removeChannel(channel); data = { version: 2, users: [], records: [], follows: [], likes: [], comments: [], goals: {} }; },
  };
  return store;
}
