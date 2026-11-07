import { catalog } from "./readtrace-data.mjs";
import {
  createStore,
  SESSION_KEY,
  labels,
  socialRecord,
} from "./readtrace-store.mjs";
import { createCoverOrbit } from "./readtrace-orbit.mjs";
import { authConfig } from "./readtrace-config.mjs";
import { createAuth, emptyAccountData } from "./readtrace-auth.mjs";
import { createBookClient, discoverySections, mergeBooks, workIdentity, canonicalIsbn, resultCacheMs } from "./readtrace-books.mjs?v=primary-stars-1";
import { ratingPicker, syncRatingPicker } from "./readtrace-rating.mjs?v=primary-stars-1";
import { createCloudStore } from "./readtrace-cloud.mjs";

const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const demoStore = createStore(localStorage);
demoStore.persist();
const guestStore = createStore(localStorage, { key: "readtrace:guest:v1", seed: () => emptyAccountData({ id: "guest", user_metadata: { name: "ゲスト" } }) });
guestStore.persist();
let store = demoStore;
let viewer = "";
let authState = { ready: false, configured: false, user: null, busy: false, error: "" };
let view = { type: "book", filter: "all", query: "", sort: "added" };
let searchType = "book",
  searchQuery = "",
  editing = null,
  authMode = "login";
let toastTimer, lastFocus;
const mobileShelf = matchMedia('(max-width: 800px)');
let shelfView = localStorage.getItem('readtrace:shelf-view:v1') || 'grid';
let orbitController = null;
const revealed = new Set();
const books = createBookClient({ endpoint: `${authConfig.url}/functions/v1/readtrace-books`, publishableKey: authConfig.publishableKey, getAccessToken: async () => (await auth.client?.auth.getSession())?.data?.session?.access_token || "" });
const works = new Map(catalog.map((work) => [work.id, work]));
const discoveryCache = new Map();
let searchField = "all", searchOrder = "relevance", searchPage = 1, searchResults = [], searchMore = false;
let searchController, searchTimer, searchVersion = 0, discoveryObserver;
let discoveryQueue = Promise.resolve();
let cloudLoading = false, cloudFailure = "", syncState = "ready", accountVersion = 0;
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => ["book-open", "clapperboard"].includes(name)
  ? '<img class="media-mark" src="./assets/readtrace-mark-web.png" alt="" aria-hidden="true" width="27" height="20">'
  : `<i data-lucide="${name}" aria-hidden="true"></i>`;
const user = (id) => store.data.users.find((u) => u.id === id);
const mine = () => user(viewer);
const route = () => location.hash.slice(1) || "/shelf";
const needsCloudLogin = () => !authState.user && new URL(location.href).searchParams.get("cloud") === "1" && /^\/(?:record|share|user)\//.test(route());
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : "";
const following = (id) =>
  store.data.follows.some(([a, b]) => a === viewer && b === id);
const countLikes = (id) => store.data.likes.filter(([, r]) => r === id).length;
const countComments = (id) =>
  store.data.comments.filter((c) => c.recordId === id).length;
const isLiked = (id) =>
  store.data.likes.some(([a, b]) => a === viewer && b === id);
const action = (name, text, extra = "", cls = "btn") =>
  `<button type="button" class="${cls}" data-action="${name}" ${name === "add" ? 'aria-label="作品を追加" title="作品を追加"' : ""} ${extra}>${text}</button>`;
function googleLoginButton() {
  return `<button type="button" class="gsi-material-button google-login" data-action="google-login" ${authState.busy ? 'disabled aria-busy="true"' : ""}>
    <span class="gsi-material-button-state" aria-hidden="true"></span>
    <span class="gsi-material-button-content-wrapper">
      <img class="gsi-material-button-icon" src="./assets/google-g-logo.png" alt="" aria-hidden="true" width="20" height="20">
      <span class="gsi-material-button-contents">Google でログイン</span>
    </span>
  </button>${authState.busy ? '<span class="google-login-status" role="status">Googleへ移動しています…</span>' : ""}`;
}
const avatar = (u) =>
  `<span class="avatar" style="--avatar:${u.color}" aria-hidden="true">${esc(u.initial)}${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : ""}</span>`;
function icons() {
  window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
}
window.addEventListener("load", icons);
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("active");
  toastTimer = setTimeout(() => $("#toast").classList.remove("active"), 2800);
}
function navigate(path) {
  if (route() === path) render();
  else location.hash = path;
}
function setSession(id) {
  if (authState.user) return;
  if (id && id !== "guest" && !demoStore.data.users.some((u) => u.id === id)) return;
  store = id === "guest" ? guestStore : demoStore;
  viewer = id;
  id
    ? localStorage.setItem(SESSION_KEY, id)
    : localStorage.removeItem(SESSION_KEY);
  view = { type: "book", filter: "all", query: "", sort: "added" };
  revealed.clear();
  closeModal();
  render();
}
function stars(value) {
  if (value === null || value === undefined) return "";
  return `<span class="rating" aria-label="5点中${value}点"><span class="stars" aria-hidden="true"><span class="stars-base">${icon("star").repeat(5)}</span><span class="stars-fill" style="--fill:${(value / 5) * 100}%">${icon("star").repeat(5)}</span></span><span>${value.toFixed(1)}</span></span>`;
}
function imageForWork(work) {
  const localImages = ["b2", "b3", "b5", "b16", "m3", "m4", "m6"];
  return localImages.includes(work.id)
    ? `./assets/${work.id}.jpg`
    : work.image;
}
function cover(work) {
  const image = imageForWork(work);
  const colors = [
    ["#dadac5", "#344b40"],
    ["#d9bfa4", "#4b382d"],
    ["#c5d2da", "#304858"],
    ["#e4d9bb", "#494536"],
    ["#c7cebc", "#3e4a3c"],
    ["#cfc1c5", "#533e48"],
  ];
  const index =
    Array.from(work.title).reduce((n, c) => n + c.codePointAt(0), 0) %
    colors.length;
  const [bg, ink] = colors[index];
  return `<span class="cover" style="--cover-bg:${bg};--cover-ink:${ink}" role="img" aria-label="${esc(work.title)}の${work.type === "book" ? "表紙" : "ポスター"}"><span class="cover-fallback" aria-hidden="true"><strong>${esc(work.title)}</strong><small>${esc(work.creator || "ReadTrace")}</small></span>${image ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>`;
}
document.addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLImageElement)
      event.target.classList.add("failed");
  },
  true,
);
document.addEventListener(
  "load",
  (event) => {
    if (
      event.target instanceof HTMLImageElement &&
      event.target.naturalWidth < 5
    )
      event.target.classList.add("failed");
  },
  true,
);
function statusBadge(r) {
  return `<span class="badge ${r.status}">${r.status === "done" ? icon("check") : ""}${labels[r.work.type][r.status]}</span>`;
}
function empty(title, copy, button = "") {
  return `<div class="empty">${icon("book-open")}<h2>${title}</h2><p>${copy}</p>${button}</div>`;
}
function showModal(title, content) {
  delete modal.dataset.media;
  lastFocus = document.activeElement;
  modal.innerHTML = `<div class="dialog-head"><h2 id="modal-title">${title}</h2>${action("close", icon("x"), 'aria-label="閉じる" title="閉じる"', "icon-btn")}</div><div class="dialog-body">${content}</div>`;
  if (!modal.open) modal.showModal();
  icons();
}
function closeModal() {
  searchController?.abort();
  clearTimeout(searchTimer);
  searchVersion++;
  if (modal.open) modal.close();
  lastFocus?.isConnected && lastFocus.focus();
}
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeModal();
  }
});

function authScreen() {
  const returning = route() !== "/shelf";
  app.innerHTML = `<main class="auth-page" id="main"><section class="auth-art"><a class="brand" href="#/shelf">${icon("book-open")}ReadTrace</a><h1>本と映画、そのあとに<br>残るもの。</h1><p>読みたい一冊も、忘れたくない一本も。<br>自分だけの棚に、少しずつ。</p><div class="auth-covers">${cover(catalog[2])}${cover(catalog[32])}${cover(catalog[0])}</div></section><section class="auth-form"><span class="eyebrow">YOUR READING & CINEMA</span><h2>あなたの棚へ</h2><p>初めての方も、Googleアカウントで始められます。</p>${returning ? '<p class="auth-return">ログイン後に、開こうとしたページへ戻ります。</p>' : ""}${googleLoginButton()}<div id="auth-error" class="error" role="alert">${esc(authState.error)}</div>${!authState.configured ? '<p class="auth-note">Googleログインは接続設定の準備中です。</p>' : ""}<p class="auth-note">Googleのパスワードを、このアプリに入力する必要はありません。記録は現在、このブラウザ内に保存されます。</p><details class="demo-options" ${authMode === "register" ? "open" : ""}><summary>デモを試す</summary><span class="demo-label">DEMO / パスワード不要</span>${authMode === "login" ? `<div class="demo-users">${demoStore.data.users.map((u) => `<button class="demo-user" data-action="login" data-id="${u.id}">${avatar(u)}<span><strong>${esc(u.name)}</strong><small>このブラウザだけのデモユーザー</small></span>${icon("arrow-right")}</button>`).join("")}</div>${action("auth-register", "デモ用の棚をつくる " + icon("arrow-right"), "", "text-btn")}` : `<form id="register-form" class="register-form" novalidate><label>デモの表示名 <span class="muted">必須</span><input name="name" required maxlength="30" autocomplete="nickname" placeholder="あなたの名前"></label><div id="register-error" class="error" role="alert"></div><button class="btn primary" type="submit">デモを始める ${icon("arrow-right")}</button>${action("auth-login", "デモユーザーを選ぶ", "", "text-btn")}</form>`}</details></section></main>`;
  $(".auth-form > p.auth-note:last-of-type").textContent = "Googleログイン後の記録はクラウドに保存されます。ゲストの記録はこのブラウザ内に保存されます。";
  if (!needsCloudLogin()) $(".auth-form .google-login").insertAdjacentHTML("afterend", action("guest-login", "ゲストで始める", "", "btn guest-login"));
  else $(".demo-options").hidden = true;
}
function navItem(path, title, glyph) {
  return `<a href="#${path}" class="${route().startsWith(path) ? "active" : ""}" ${route().startsWith(path) ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${title}</span></a>`;
}
function monthCount() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return store
    .visible(viewer, viewer)
    .filter(
      (r) =>
        r.work.type === "book" &&
        r.status === "done" &&
        r.completedAt?.startsWith(ym),
    ).length;
}
function shell(content) {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="header-inner">
          <a href="#/shelf" class="brand">${icon("book-open")}<span>ReadTrace</span></a>
          <nav class="nav" aria-label="メインナビゲーション">
            ${navItem("/shelf", "自分の棚", "library")}
            ${navItem("/discover", "本を探す", "compass")}
            ${navItem("/feed", "みんなの記録", "notebook-pen")}
            ${navItem("/people", "ユーザーを探す", "users")}
          </nav>
          <div class="topbar-right">
            ${authState.user ? action("cloud-refresh", icon(syncState === "error" ? "cloud-off" : "cloud"), `aria-label="${syncState === "error" ? "接続を確認して再同期" : "クラウドを再読み込み"}" title="${syncState === "syncing" ? "同期中" : syncState === "error" ? "接続を確認して再同期" : "クラウド保存"}"`, "icon-btn cloud-status") : `<span class="local-mode">${viewer === "guest" ? "ゲスト" : "デモ"}・端末内保存</span>`}
            ${action("add", icon("plus") + "作品を追加", "", "btn primary desktop-add")}
            <button class="header-account" data-action="account" aria-label="アカウント" title="${esc(mine().name)}のアカウント">${avatar(mine())}</button>
          </div>
        </div>
      </header>
      <main class="main" id="main">${content}</main>
      <nav class="mobile-nav" aria-label="モバイルナビゲーション">
        ${navItem("/shelf", "本棚", "library")}
        ${navItem("/feed", "みんな", "notebook-pen")}
        ${action("add", icon("plus"), '', "mobile-add")}
        ${navItem("/discover", "さがす", "compass")}
        <button data-action="account" aria-label="アカウント">${icon("circle-user-round")}<span>自分</span></button>
      </nav>
    </div>`;
}
function card(r) {
  return `<article class="work-card">
    <a href="#/record/${r.id}" class="card-link" aria-label="${esc(r.work.title)}の記録を開く">
      <div class="cover-stage">${cover(r.work)}${r.visibility === "private" ? `<span class="private-marker" title="非公開" aria-label="非公開">${icon("lock-keyhole")}</span>` : ""}</div>
      <h3 class="card-title">${esc(r.work.title)}</h3>
      <p class="creator">${esc(r.work.creator || "著者・監督未設定")}</p>
      <div class="card-meta">${statusBadge(r)}${r.review ? `<span class="review-marker" title="${r.spoiler ? 'ネタバレを含む感想あり' : '感想あり'}">${icon(r.spoiler ? 'eye-off' : 'message-square-text')}</span>` : ''}</div>
      ${stars(r.rating)}
    </a>
    ${r.userId === viewer ? action('edit', icon('ellipsis'), `data-id="${r.id}" aria-label="${esc(r.work.title)}の記録を編集" title="記録を編集"`, 'card-edit icon-btn') : ''}
  </article>`;
}
function shelfContext() {
  const p = route().split("/");
  if (p[1] === "share")
    return { owner: p[2], type: p[3], shared: p[4], publicOnly: true };
  return {
    owner: p[1] === "user" ? p[2] : viewer,
    type: view.type,
    shared: "",
    publicOnly: p[1] === "user",
  };
}
function shelfRecords() {
  const c = shelfContext();
  return store
    .visible(viewer, c.owner)
    .filter(
      (r) =>
        r.work.type === c.type &&
        (!c.publicOnly || r.visibility === "public") &&
        (!c.shared || r.status === c.shared),
    );
}
function filteredRecords() {
  let records = shelfRecords().filter(
    (r) =>
      (view.filter === "all" || r.status === view.filter) &&
      (!view.ratingFilter || view.ratingFilter === "all" || (view.ratingFilter === "unrated" ? r.rating === null : (r.rating ?? 0) >= Number(view.ratingFilter))) &&
      (!view.addedAfter || new Date(r.createdAt) >= new Date(`${view.addedAfter}T00:00:00`)) &&
      `${r.work.title} ${r.work.creator}`
        .toLocaleLowerCase()
        .includes(view.query.toLocaleLowerCase()),
  );
  return records.sort((a, b) =>
    view.sort === "rating"
      ? (b.rating ?? -1) - (a.rating ?? -1)
      : view.sort === "completed"
        ? (b.completedAt || "").localeCompare(a.completedAt || "")
        : view.sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt),
  );
}
function renderShelfGrid() {
  orbitController?.dispose();
  orbitController = null;
  const records = filteredRecords(),
    c = shelfContext(),
    own = c.owner === viewer && !c.shared;
  $("#shelf-grid").innerHTML = records.length
    ? records.map(card).join("")
    : empty(
        view.query ? "作品が見つかりません" : c.type === "book" ? "本棚はまだ空です" : "映画の記録はまだありません",
        view.query
          ? "検索語や絞り込みを変えてみてください。"
          : own
            ? "読みたい一冊、観たい一本から、棚を育ててみませんか。"
            : "公開された作品が追加されると、ここに並びます。",
        own
          ? action("add", icon("plus") + "作品を追加", "", "btn primary") + (c.type === "book" ? '<a href="#/discover" class="btn">本を見つける</a>' : "")
          : "",
      );
  $("#result-count").textContent = `${records.length}作品`;
  const opening = $("#shelf-opening");
  if (opening) opening.hidden = view.filter !== "all" || Boolean(view.query) || Boolean(view.addedAfter) || Boolean(view.ratingFilter && view.ratingFilter !== "all");
  renderMobileShelf(records);
  icons();
}
function renderMobileShelf(records) {
  const grid = $('#shelf-grid');
  grid.hidden = false;
  document.documentElement.dataset.shelfView = 'grid';
  $('.shelf-orbit')?.remove();
  if (!$('.shelf-view-switch')) {
    $('.media-toolbar').insertAdjacentHTML('beforeend', `<div class="shelf-view-switch" role="group" aria-label="棚の表示方法">
      ${action('shelf-view', icon('box'), 'data-view="orbit" title="回転する棚" aria-label="回転する棚"', 'icon-btn')}
      ${action('shelf-view', icon('layout-grid'), 'data-view="grid" title="一覧表示" aria-label="一覧表示"', 'icon-btn')}
    </div>`);
  }
  const updateButtons = () => document.querySelectorAll('[data-action="shelf-view"]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === shelfView));
  updateButtons();
  if (!mobileShelf.matches || shelfView !== 'orbit' || !records.length) return;
  grid.insertAdjacentHTML('beforebegin', `<section class="shelf-orbit" aria-label="回転する棚">
    <div class="orbit-stage" id="orbit-stage"></div>
    <div class="orbit-controls">
      ${action('orbit-prev', icon('chevron-left'), 'aria-label="前の作品" title="前の作品"', 'icon-btn')}
      <span class="orbit-counter" id="orbit-counter" aria-live="polite"></span>
      ${action('orbit-spin', icon('rotate-3d'), 'aria-label="表紙を一周回す" title="表紙を一周回す"', 'icon-btn')}
      ${action('orbit-next', icon('chevron-right'), 'aria-label="次の作品" title="次の作品"', 'icon-btn')}
    </div>
    <div class="orbit-caption" id="orbit-caption" aria-live="polite"></div>
  </section>`);
  document.documentElement.dataset.shelfView = 'orbit';
  grid.hidden = true;
  orbitController = createCoverOrbit($('#orbit-stage'), {
    records,
    imageFor: imageForWork,
    onOpen: record => navigate(`/record/${record.id}`),
    onSelect(record, index) {
      $('#orbit-counter').textContent = `${String(index + 1).padStart(2,'0')} / ${String(records.length).padStart(2,'0')}`;
      $('#orbit-caption').innerHTML = `<h2><a href="#/record/${record.id}" aria-label="${esc(record.work.title)}の記録を開く">${esc(record.work.title)}</a></h2>
        <p class="creator">${esc(record.work.creator || '著者・監督未設定')}</p>
        <div class="orbit-meta">${statusBadge(record)}${stars(record.rating)}${record.visibility === 'private' ? '<span class="badge">'+icon('lock-keyhole')+'非公開</span>' : ''}</div>
        <a class="text-btn" href="#/record/${record.id}">記録を見る ${icon('arrow-right')}</a>`;
      icons();
    },
    onUnavailable() {
      shelfView = 'grid';
      grid.hidden = false;
      $('.shelf-orbit').hidden = true;
      document.documentElement.dataset.shelfView = 'grid';
      updateButtons();
      toast('立体表示を利用できないため、一覧を表示しました');
    }
  });
}
mobileShelf.addEventListener('change', () => { if ($('#shelf-grid')) renderShelfGrid(); });
function shelfOpening(type, all) {
  const current = all.filter(r => r.work.type === type && ['reading', 'watching'].includes(r.status));
  if (!current.length) return '';
  const goal = store.data.goals[viewer] || 5;
  const count = monthCount();
  const month = new Date().getMonth() + 1;
  return `<section class="shelf-opening" id="shelf-opening" aria-label="進行中の作品と読書目標">
    <div class="current-section">
      <div class="section-heading"><h2>${type === 'book' ? 'いま、読んでいる' : 'いま、観ている'}</h2><span>${current.length}${type === 'book' ? '冊' : '本'}</span></div>
      <div class="current-rail">${current.map(r => `<article class="current-work">
        <a href="#/record/${r.id}" class="current-cover" aria-label="${esc(r.work.title)}の進行中の記録">${cover(r.work)}</a>
        <div class="current-copy"><span class="current-label">${icon(type === 'book' ? 'bookmark' : 'play')} ${labels[type][r.status]}</span><h3><a href="#/record/${r.id}">${esc(r.work.title)}</a></h3><p>${esc(r.work.creator)}</p>${action('edit', icon('pencil-line') + '記録をつける', `data-id="${r.id}"`, 'text-btn')}</div>
      </article>`).join('')}</div>
    </div>
    <button class="month-note" data-action="goal" aria-label="今月の読書目標を開く">
      <span class="note-heading">${month}月の読書目標 ${icon('arrow-up-right')}</span>
      <span class="note-body"><span class="mini-ring" style="--progress:${Math.min(100,count/goal*100)}%">${icon('book-open')}</span><span class="note-number"><strong>${count}<small> / ${goal}</small></strong><span>冊 読了</span></span></span>
      <span class="note-caption">${count >= goal ? '今月の目標を達成しました' : `目標まで、あと${goal-count}冊。`}</span>
    </button>
  </section>`;
}
function shelfScreen() {
  const c = shelfContext(),
    owner = user(c.owner);
  if (
    !owner ||
    !labels[c.type] ||
    (c.shared && !["done", "want"].includes(c.shared))
  )
    return empty(
      "ページが見つかりません",
      "リンクを確認してください。",
      '<a class="btn" href="#/shelf">自分の棚へ</a>',
    );
  const own = route() === "/shelf";
  const all = store
    .visible(viewer, c.owner)
    .filter((r) => !c.publicOnly || r.visibility === "public");
  const counts = {
    book: all.filter((r) => r.work.type === "book").length,
    movie: all.filter((r) => r.work.type === "movie").length,
  };
  const share = action('share-shelf', icon('share-2'), 'aria-label="棚を共有" title="棚を共有"', 'icon-btn shelf-share');
  const heading = own ? `
    <div class="page-title shelf-title"><div><p class="kicker">MY LIBRARY</p><h1>自分の棚<span class="title-dot" aria-hidden="true">.</span></h1><p>${esc(owner.name)}さんの、本と映画の記録。</p></div>
    <div class="shelf-heading-actions"><div class="tally"><span>${icon('book-open')}<strong>${all.filter(r=>r.work.type==='book'&&r.status==='done').length}</strong>冊 読了</span><span>${icon('clapperboard')}<strong>${all.filter(r=>r.work.type==='movie'&&r.status==='done').length}</strong>本 鑑賞</span></div>${share}</div></div>` : `
    <section class="profile-head"><span class="avatar large" style="--avatar:${owner.color}">${esc(owner.initial)}</span><div class="profile-copy"><h1>${esc(owner.name)}</h1><p>${esc(owner.bio || "この人の本と映画の記録。")}</p><div class="profile-count"><span><strong>${all.length}</strong>公開作品</span><span><strong>${store.data.follows.filter(([a])=>a===owner.id).length}</strong>フォロー</span><span><strong>${store.data.follows.filter(([,b])=>b===owner.id).length}</strong>フォロワー</span></div></div><div class="profile-actions">${owner.id!==viewer?followButton(owner.id):''}${share}</div></section>`;
  const tabs = `<div class="media-toolbar"><div class="tabs" role="tablist" aria-label="棚の種別">${['book','movie'].map(type=>`<button class="tab" role="tab" id="tab-${type}" aria-selected="${c.type===type}" aria-controls="shelf-panel" data-action="shelf-type" data-type="${type}">${icon(type==='book'?'book-open':'clapperboard')}${type==='book'?'本の棚':'映画の棚'}<small>${counts[type]}</small></button>`).join('')}</div><span class="collection-caption">BOOKS & FILMS, WITH YOU.</span></div>`;
  const filters = ['all',...Object.keys(labels[c.type])].filter(s=>!c.shared||s==='all'||s===c.shared).map(s=>`<button class="filter" aria-pressed="${view.filter===s}" data-action="filter" data-filter="${s}">${s==='all'?'すべて':labels[c.type][s]}<small>${shelfRecords().filter(r=>s==='all'||r.status===s).length}</small></button>`).join('');
  return `${c.shared?`<div class="shared-label">${icon('link')} ${esc(owner.name)}さんの${c.type==='book'?'本':'映画'}の棚 · ${labels[c.type][c.shared]}リスト</div>`:''}${heading}${tabs}
    <section id="shelf-panel" role="tabpanel" aria-labelledby="tab-${c.type}">
      ${own?shelfOpening(c.type,all):''}
      <div class="collection-heading"><h2>${c.type==='book'?'本の記録':'映画の記録'}</h2><span class="collection-number">${String(shelfRecords().length).padStart(2,'0')}</span></div>
      <div class="shelf-tools"><div class="filters" aria-label="状態で絞り込み">${filters}</div><div class="search-sort"><label class="search-box">${icon('search')}<input id="shelf-search" type="search" aria-label="棚の作品を検索" placeholder="この棚を検索" value="${esc(view.query)}"></label><label class="sort-box">${icon('arrow-down-wide-narrow')}<select id="shelf-sort" aria-label="作品の並べ替え"><option value="added" ${view.sort==='added'?'selected':''}>追加順</option><option value="completed" ${view.sort==='completed'?'selected':''}>完了日順</option><option value="rating" ${view.sort==='rating'?'selected':''}>評価順</option></select></label></div></div>
      <div class="shelf-grid" id="shelf-grid"></div>
      <footer class="shelf-footer"><span id="result-count"></span><span>ReadTrace <span class="footer-dot">·</span> 本と映画、その余韻を。</span></footer>
    </section>`;
}
function followButton(id) {
  return action(
    "follow",
    icon(following(id) ? "user-check" : "user-plus") +
      (following(id) ? "フォロー中" : "フォローする"),
    `data-id="${id}" aria-pressed="${following(id)}"`,
    following(id) ? "btn subtle" : "btn primary",
  );
}
function review(r, preview = false) {
  if (!r.review)
    return `<p class="muted review-text">感想はまだありません。</p>`;
  // Spoiler text is never inserted into list previews or hidden detail markup.
  if (r.spoiler && (preview || (!revealed.has(r.id) && r.userId !== viewer)))
    return `<div class="spoiler-box"><span>${icon("eye-off")} ネタバレを含む感想です</span>${preview ? `<a class="btn" href="#/record/${r.id}">記録を開く ${icon("arrow-right")}</a>` : action("reveal", "ネタバレを表示", `data-id="${r.id}"`)}</div>`;
  return `${r.spoiler ? '<span class="badge">ネタバレあり</span>' : ""}<p class="review-text">${esc(r.review)}</p>`;
}
function socialButtons(r) {
  if (!socialRecord(r)) return "";
  return `<div class="social-actions"><button data-action="like" data-id="${r.id}" class="${isLiked(r.id) ? "liked" : ""}" aria-label="${isLiked(r.id) ? "いいねを解除" : "いいね"}" aria-pressed="${isLiked(r.id)}">${icon("heart")}<span>${countLikes(r.id)}</span></button><a href="#/record/${r.id}" aria-label="コメントを見る">${icon("message-circle")} ${countComments(r.id)}</a>${action("share-record", icon("share-2") + "共有", `data-id="${r.id}"`, "")}</div>`;
}
function feedScreen() {
  const ids = store.data.follows
    .filter(([a]) => a === viewer)
    .map(([, b]) => b);
  const records = store
    .visible(viewer)
    .filter((r) => ids.includes(r.userId) && r.visibility === "public")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `<div class="page-title"><div><p class="kicker">FOLLOWING</p><h1>みんなの記録</h1><p>フォローした人の、心に残った作品。</p></div><a class="btn" href="#/people">${icon("users")}ユーザーを探す</a></div><div class="feed">${
    records.length
      ? records
          .map((r) => {
            const u = user(r.userId);
            return `<article class="feed-item"><div class="feed-user"><a href="#/user/${u.id}" class="row">${avatar(u)}<strong>${esc(u.name)}</strong></a><span class="badge">${labels[r.work.type][r.status]}</span><time>${date(r.completedAt || r.createdAt)}</time></div><div class="feed-body"><a href="#/record/${r.id}" tabindex="-1" aria-hidden="true">${cover(r.work)}</a><div><h2><a href="#/record/${r.id}">${esc(r.work.title)}</a></h2><p class="creator">${esc(r.work.creator)}</p>${stars(r.rating)}${review(r, true)}${socialButtons(r)}</div></div></article>`;
          })
          .join("")
      : empty(
          "気になる人を、見つけよう。",
          "フォローした人の公開された記録がここに届きます。",
          '<a class="btn primary" href="#/people">ユーザーを探す</a>',
        )
  }</div>`;
}
function peopleScreen() {
  const users = store.data.users.filter((u) => u.id !== viewer);
  return `<div class="page-title"><div><p class="kicker">PEOPLE</p><h1>ユーザーを探す</h1><p>好きな作品から、次の出会いへ。</p></div></div><label class="search-box" style="max-width:360px;margin-bottom:26px">${icon("search")}<input id="people-search" type="search" placeholder="名前で検索" aria-label="ユーザーを検索"></label><div class="user-grid" id="user-grid">${users.map((u) => `<article class="user-card" data-name="${esc(u.name.toLocaleLowerCase())}"><div class="row"><a href="#/user/${u.id}" class="row">${avatar(u)}${esc(u.name)}</a></div><p>${esc(u.bio || "自分のペースで、本と映画を記録しています。")}</p><a class="text-btn" href="#/user/${u.id}">公開された棚を見る ${icon("arrow-right")}</a>${followButton(u.id)}</article>`).join("")}</div><div id="people-empty" hidden><p>一致するユーザーがいません。</p></div>`;
}
function detailScreen(id) {
  const r = store.get(id, viewer);
  if (!r)
    return empty(
      "この記録は表示できません",
      "削除されたか、公開されていない記録です。",
      '<a class="btn" href="#/shelf">自分の棚へ</a>',
    );
  const u = user(r.userId),
    own = r.userId === viewer;
  return `<a class="text-btn" href="#${own ? "/shelf" : `/user/${u.id}`}">${icon("arrow-left")} ${own ? "自分の棚へ" : esc(u.name) + "さんの棚へ"}</a><div class="detail-layout"><div class="detail-art">${cover(r.work)}</div><article class="detail-head"><div>${statusBadge(r)} ${r.visibility === "private" ? '<span class="badge">' + icon("lock-keyhole") + "非公開</span>" : ""}</div><h1>${esc(r.work.title)}</h1><p class="creator">${esc(r.work.creator || "著者・監督未設定")}${r.work.year ? " / " + esc(r.work.year) : ""}</p>${stars(r.rating)}<div class="detail-owner"><a class="row" href="#/user/${u.id}">${avatar(u)}${esc(u.name)}</a><span class="muted">${r.completedAt ? date(r.completedAt) + (r.work.type === "book" ? " 読了" : " 鑑賞") : labels[r.work.type][r.status]}</span></div>${review(r)}${socialButtons(r)}<div class="detail-commands">${own ? action("edit", icon("pencil") + "記録を編集", `data-id="${r.id}"`, "btn primary") : action("save-work", icon("plus") + "自分の棚に追加", `data-id="${r.id}"`, "btn")}${r.visibility === "public" ? action("share-record", icon("link") + "共有URL", `data-id="${r.id}"`) : own ? '<span class="muted field-hint">非公開の記録は共有できません。</span>' : ""}</div>${socialRecord(r) ? comments(r) : ""}</article></div>`;
}
function comments(r) {
  const list = store.data.comments.filter((c) => c.recordId === r.id);
  const hidden = r.spoiler && r.userId !== viewer && !revealed.has(r.id);
  return `<section class="comments"><h2>コメント <small>${list.length}</small></h2>${
    hidden
      ? '<p class="muted">ネタバレを表示すると、コメントも読めます。</p>'
      : `${
          list
            .map((c) => {
              const u = user(c.userId);
              return `<article class="comment"><div class="comment-meta"><a href="#/user/${u.id}" class="row">${avatar(u)}<strong>${esc(u.name)}</strong></a><time>${date(c.createdAt)}</time>${c.userId === viewer ? action("delete-comment", icon("trash-2"), `data-id="${c.id}" aria-label="自分のコメントを削除" title="自分のコメントを削除"`, "icon-btn") : ""}</div><p>${esc(c.text)}</p></article>`;
            })
            .join("") || '<p class="muted">最初のひとことを残しませんか。</p>'
        }<form class="comment-form" id="comment-form" data-id="${r.id}" novalidate><label for="comment-text">コメントを書く</label><textarea id="comment-text" name="comment" maxlength="1000" placeholder="作品の感想を分かち合う"></textarea><div id="comment-error" class="error" role="alert"></div><button class="btn primary" type="submit">${icon("send")}コメントを投稿</button></form>`
  }</section>`;
}
function render() {
  discoveryObserver?.disconnect();
  orbitController?.dispose();
  orbitController = null;
  document.documentElement.dataset.shelfView = 'grid';
  const mediaRoute = route().split('/');
  const activeRecord = mediaRoute[1] === 'record' ? store.get(mediaRoute[2], viewer) : null;
  document.documentElement.dataset.media = activeRecord?.work.type || (mediaRoute[1] === 'share' ? mediaRoute[3] : view.type);
  if (!authState.ready) {
    app.innerHTML = '<main id="main" class="auth-loading" role="status">ログイン状態を確認しています…</main>';
    return;
  }
  if (!viewer || needsCloudLogin()) {
    authScreen();
    icons();
    return;
  }
  if (cloudLoading) { app.innerHTML = `<main id="main" class="cloud-loading"><p role="status">あなたの棚を読み込んでいます…</p>${skeletons()}</main>`; return; }
  if (cloudFailure) { app.innerHTML = `<main id="main" class="cloud-loading"><h1>棚を読み込めませんでした</h1><p class="error" role="alert">${esc(cloudFailure)}</p>${action("cloud-retry", icon("refresh-cw") + "再読み込み")}${action("logout", icon("log-out") + "ログアウト")}</main>`; icons(); return; }
  const p = route().split("/");
  let content;
  if (["shelf", "user", "share"].includes(p[1])) content = shelfScreen();
  else if (p[1] === "feed") content = feedScreen();
  else if (p[1] === "people") content = peopleScreen();
  else if (p[1] === "discover") content = discoverScreen();
  else if (p[1] === "record") content = detailScreen(p[2]);
  else
    content = empty(
      "ページが見つかりません",
      "リンクを確認してください。",
      '<a class="btn" href="#/shelf">自分の棚へ</a>',
    );
  shell(content);
  if (p[1] === "record") {
    const record = store.get(p[2], viewer);
    if (record && $(".detail-head")) {
      if (record.startedAt) $(".detail-owner").insertAdjacentHTML("afterend", `<p class="field-hint">${record.work.type === "book" ? "読書" : "鑑賞"}開始日 ${esc(record.startedAt)}</p>`);
      if (record.work.publisher || record.work.isbn13) $(".detail-head .creator").insertAdjacentHTML("afterend", `<p class="field-hint">${esc([record.work.publisher, record.work.publishedAt, record.work.isbn13 ? `ISBN ${record.work.isbn13}` : ""].filter(Boolean).join(" / "))}</p>`);
    }
  }
  if ($("#shelf-grid")) {
    $(".shelf-tools").insertAdjacentHTML("afterend", `<div class="shelf-extra-filters"><label>評価<select id="rating-filter"><option value="all">すべて</option><option value="unrated">未評価</option>${[1, 2, 3, 4, 4.5, 5].map((n) => `<option value="${n}" ${String(view.ratingFilter) === String(n) ? "selected" : ""}>${n}以上</option>`).join("")}</select></label><label>登録日以降<input id="added-after" type="date" value="${esc(view.addedAfter || "")}"></label>${action("reset-shelf-filters", icon("filter-x"), 'aria-label="絞り込みを解除" title="絞り込みを解除"', "icon-btn")}</div>`);
    $("#rating-filter").value = view.ratingFilter || "all";
    $("#shelf-sort").insertAdjacentHTML("beforeend", `<option value="oldest" ${view.sort === "oldest" ? "selected" : ""}>登録が古い順</option>`);
    renderShelfGrid();
  }
  if (p[1] === "discover") hydrateDiscovery();
  icons();
}
window.addEventListener("hashchange", async () => {
  view.filter = "all";
  view.query = "";
  revealed.clear();
  closeModal();
  const path = route(), current = store;
  if (current.mode === "cloud") {
    try { await current.ensureRoute(path); } catch (error) { toast(error.message); }
    if (route() !== path || store !== current) return;
  }
  render();
  window.scrollTo(0, 0);
});
window.addEventListener("storage", (e) => {
  if (e.key === SESSION_KEY && !authState.user) location.reload();
});
window.addEventListener("focus", () => { if (store.mode === "cloud") void store.refresh().catch(() => {}); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && store.mode === "cloud") void store.refresh().catch(() => {}); });

function openSearch(reset = true) {
  if (reset) {
    searchType = view.type;
    searchQuery = "";
    searchField = "all";
    searchOrder = "relevance";
  }
  searchController?.abort();
  clearTimeout(searchTimer);
  searchVersion++;
  showModal(
    "作品を探す",
    `<div class="search-type" role="group" aria-label="検索する作品の種別">${["book", "movie"].map((t) => action("search-type", icon(t === "book" ? "book-open" : "clapperboard") + (t === "book" ? "本を探す" : "映画を探す"), `data-type="${t}" aria-pressed="${searchType === t}"`, searchType === t ? "btn active" : "btn")).join("")}</div>${searchType === "book" ? `<label class="search-field-label">検索対象<select id="catalog-field"><option value="all" ${searchField === "all" ? "selected" : ""}>書名・著者・ISBN</option><option value="title" ${searchField === "title" ? "selected" : ""}>書名</option><option value="author" ${searchField === "author" ? "selected" : ""}>著者</option><option value="isbn" ${searchField === "isbn" ? "selected" : ""}>ISBN</option></select></label>` : ""}<label class="catalog-input">${icon("search")}<input id="catalog-search" type="search" placeholder="${searchType === "book" ? "書名・著者名・ISBN" : "映画のタイトル・監督"}" aria-label="作品を検索" value="${esc(searchQuery)}" autocomplete="off" maxlength="160"></label><p class="catalog-info" id="catalog-info" role="status"></p><div class="catalog-results" id="catalog-results"></div><div id="catalog-pagination"></div><div class="manual-link"><span>見つからない作品も、自分の棚へ。</span>${action("manual", "手入力で追加 " + icon("arrow-right"), "", "text-btn")}</div>`,
  );
  void renderCatalog();
  modal.dataset.media = searchType;
  $("#catalog-search").focus();
}
const skeletons = (count = 5) => `<div class="search-skeleton" aria-label="検索中">${Array.from({ length: count }, () => '<div class="skeleton-item"><span></span><i></i></div>').join("")}</div>`;
function catalogRows() {
  $("#catalog-results").innerHTML = searchResults.map((w) => `<button class="catalog-item" data-action="work-detail" data-id="${esc(w.id)}">${cover(w)}<span><strong>${esc(w.title)}</strong><small>${esc(w.creator || "著者・監督未設定")}</small><small>${esc([w.publisher, w.publishedAt || w.year].filter(Boolean).join(" / "))}</small></span>${icon("chevron-right")}</button>`).join("");
}
async function renderCatalog(append = false) {
  searchController?.abort();
  searchController = new AbortController();
  const version = ++searchVersion, type = searchType;
  if (!$("#catalog-results")) return;
  if (!append) { searchPage = 1; searchResults = []; $("#catalog-results").innerHTML = skeletons(); }
  $("#catalog-info").textContent = "作品を探しています…";
  $("#catalog-pagination").innerHTML = "";
  try {
    let result;
    if (type === "book") result = await books.search({ query: searchQuery.trim() || "小説", field: searchField, order: searchOrder, page: searchPage, signal: searchController.signal });
    else result = await books.search({ type: "movie", query: searchQuery.trim() || "映画", signal: searchController.signal });
    if (version !== searchVersion || !$("#catalog-results")) return;
    searchResults = mergeBooks(append ? searchResults : [], result.items);
    searchMore = result.hasMore;
    searchResults.forEach((w) => works.set(w.id, w));
    $("#catalog-info").textContent = `${searchResults.length}件 / ${result.sources.join("・")}${result.warnings.length ? `。${result.warnings.join(" ")}` : ""}`;
    if (searchResults.length) catalogRows();
    else $("#catalog-results").innerHTML = empty("作品が見つかりません", `「${esc(searchQuery)}」を引き継いで手入力できます。`, action("manual", "このタイトルで手入力", "", "btn primary"));
    if (searchMore) $("#catalog-pagination").innerHTML = action("search-more", icon("plus") + "さらに読み込む", "", "btn load-more");
    icons();
  } catch (error) {
    if (version !== searchVersion || !$("#catalog-results")) return;
    $("#catalog-info").textContent = "";
    if (!append) $("#catalog-results").innerHTML = "";
    $("#catalog-pagination").innerHTML = `<div class="error" role="alert">${esc(error.message)}</div>${action("search-retry", icon("refresh-cw") + "再検索")}`;
    if (append) searchPage--;
    icons();
  }
}
function openWorkDetail(work) {
  if (!work) return;
  showModal(work.type === "book" ? "本の詳細" : "映画の詳細", `<div class="work-preview work-bibliography">${cover(work)}<div><h3>${esc(work.title)}</h3><p>${esc(work.creator || "著者・監督未設定")}</p><p class="muted">${esc([work.publisher, work.publishedAt || work.year].filter(Boolean).join(" / "))}</p>${work.isbn13 ? `<p class="field-hint">ISBN ${esc(work.isbn13)}</p>` : ""}</div></div><p class="book-description">${esc(work.description || "概要は提供されていません。")}</p>${work.sourceUrl ? `<a class="text-btn" href="${esc(work.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(work.source)} ${icon("external-link")}</a>` : ""}<div class="dialog-actions">${action("select-work", icon("plus") + "自分の棚に追加", `data-id="${esc(work.id)}"`, "btn primary")}</div>`);
  modal.dataset.media = work.type;
}
function discoverScreen() {
  return `<div class="page-title"><div><p class="kicker">DISCOVER</p><h1>次に読みたい、一冊。</h1></div>${action("search-books", icon("search") + "本を検索", "", "btn primary")}</div>${discoverySections.map((section) => `<section class="discovery-section" data-discovery="${section.id}"><div class="section-heading"><h2>${section.title}</h2>${action("discover-more", "もっと見る " + icon("arrow-right"), `data-section="${section.id}"`, "text-btn")}</div><div class="discovery-rail" id="discovery-${section.id}">${Array.from({ length: 6 }, () => '<div class="discovery-skeleton" aria-hidden="true"></div>').join("")}</div></section>`).join("")}`;
}
function hydrateDiscovery() {
  discoveryObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    discoveryObserver.unobserve(entry.target);
    const section = discoverySections.find((s) => s.id === entry.target.dataset.discovery);
    discoveryQueue = discoveryQueue.then(async () => {
      const target = $(`#discovery-${section.id}`);
      if (!target) return;
      try {
        const cached = discoveryCache.get(section.id);
        const hit = cached?.expires > Date.now();
        const result = hit ? cached.value : await books.search({ query: section.query, order: section.order || "relevance", page: 1 });
        if (!hit) {
          const lifetime = resultCacheMs(result);
          if (lifetime > 0) discoveryCache.set(section.id, { value: result, expires: Date.now() + lifetime });
          else discoveryCache.delete(section.id);
        }
        if (!target.isConnected) return;
        result.items.forEach((w) => works.set(w.id, w));
        target.innerHTML = result.items.length ? result.items.slice(0, 8).map((w) => `<button class="discovery-book" data-action="work-detail" data-id="${esc(w.id)}">${cover(w)}<strong>${esc(w.title)}</strong><small>${esc(w.creator)}</small></button>`).join("") : '<p class="muted">この条件では本が見つかりませんでした。</p>';
      } catch { if (target.isConnected) target.innerHTML = `<div class="discovery-error"><p>書誌データを取得できませんでした。</p>${action("discover-retry", icon("refresh-cw") + "再試行", `data-section="${section.id}"`)}</div>`; }
      icons();
    });
  }), { rootMargin: "180px" });
  document.querySelectorAll("[data-discovery]").forEach((node) => discoveryObserver.observe(node));
}
function openEditor(work, record = null, manual = false) {
  editing = { work: { ...work }, record, manual };
  const r = record || {
    status: "want",
    rating: null,
    review: "",
    spoiler: false,
    visibility: "public",
    completedAt: "",
  };
  showModal(
    record ? "記録を編集" : manual ? "作品を手入力" : "自分の棚に追加",
    `<form id="record-form" novalidate>${manual ? `<div class="form-grid"><label>種別 <span class="muted">必須</span><select name="type" id="edit-type"><option value="book" ${work.type === "book" ? "selected" : ""}>本</option><option value="movie" ${work.type === "movie" ? "selected" : ""}>映画</option></select></label><label>タイトル <span class="muted">必須</span><input name="title" value="${esc(work.title)}" required maxlength="200"></label><label>${work.type === "book" ? "著者" : "監督"} <span class="muted">任意</span><input name="creator" value="${esc(work.creator)}" maxlength="120"></label><label>画像URL <span class="muted">任意</span><input type="url" name="image" value="${esc(work.image)}" placeholder="https://..."></label></div>` : `<div class="work-preview">${cover(work)}<div><span class="badge">${work.type === "book" ? "本" : "映画"}</span><h3>${esc(work.title)}</h3><p class="muted">${esc(work.creator)}</p></div></div>`}<div class="form-grid" style="margin-top:20px"><label class="wide">状態<select name="status" id="edit-status">${Object.entries(
      labels[work.type],
    )
      .map(
        ([key, label]) =>
          `<option value="${key}" ${r.status === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><fieldset class="wide"><legend>評価 <span id="rating-required" class="muted">${r.status === "done" ? "必須" : "任意"}</span></legend><div class="rating-control">${ratingPicker(r.rating, icon)}<label class="check-label"><input type="checkbox" id="no-rating" ${r.rating === null ? "checked" : ""}>未評価</label></div></fieldset><label class="wide">感想 <span class="muted">任意</span><textarea name="review" maxlength="10000" placeholder="心に残ったことを、ひとことでも。">${esc(r.review)}</textarea></label><label class="wide check-label"><input name="spoiler" type="checkbox" ${r.spoiler ? "checked" : ""}>ネタバレあり</label><label>読了日・鑑賞日 <span class="muted">任意</span><input name="completedAt" type="date" value="${esc(r.completedAt)}"></label><label>公開範囲<select name="visibility"><option value="public" ${r.visibility === "public" ? "selected" : ""}>公開（ログインユーザー）</option><option value="private" ${r.visibility === "private" ? "selected" : ""}>非公開（自分だけ）</option></select></label></div><div class="error" id="record-error" role="alert"></div><div class="dialog-actions">${record ? action("delete-record", icon("trash-2"), `data-id="${record.id}" aria-label="記録を削除" title="記録を削除"`, "btn danger") : ""}${action("close", "キャンセル")}<button class="btn primary" type="submit">${icon("check")}${record ? "変更を保存" : "棚に追加"}</button></div></form>`,
  );
  modal.dataset.media = work.type;
  $('input[name="completedAt"]').closest("label").insertAdjacentHTML("beforebegin", `<label>読書・鑑賞開始日 <span class="muted">任意</span><input name="startedAt" type="date" value="${esc(r.startedAt || "")}"></label>`);
  if (manual) $('input[name="image"]').closest("label").insertAdjacentHTML("beforebegin", `<label id="manual-isbn-label" ${work.type !== "book" ? "hidden" : ""}>ISBN <span class="muted">任意</span><input name="isbn" inputmode="text" value="${esc(work.isbn13 || work.isbn || "")}" maxlength="24"></label>`);
}
function ratingUpdate() {
  const picker = $("#rating-picker");
  const selected = picker.querySelector('input[name="rating"]:checked');
  const n = $("#no-rating").checked ? null : Number(selected?.value || picker.dataset.lastRating || 3);
  syncRatingPicker(picker, n);
  $("#rating-value").textContent = n === null ? "未評価" : `${n.toFixed(1)}点`;
}
function selectWork(work) {
  if (!work) return;
  const existing = store
    .visible(viewer, viewer)
    .find((r) => workIdentity(r.work) === workIdentity(work));
  if (existing) {
    closeModal();
    navigate(`/record/${existing.id}`);
    toast("この作品はすでに棚にあります");
  } else openEditor(work);
}
function openAccount() {
  if (authState.user) {
    showModal("アカウント", `<div class="row account-identity">${avatar(mine())}<div><strong>${esc(mine().name)}</strong><p class="muted">Googleアカウント / クラウド保存</p></div></div><div class="stack">${action("business-contact", icon("mail") + "製作者へのお問い合わせ")}<a class="btn" data-close href="#/user/${viewer}">${icon("user-round")}プロフィールを見る</a>${action("goal", icon("chart-no-axes-combined") + "読書目標と実績")}${action("import-local", icon("import") + "端末の記録を取り込む")}${action("cloud-refresh", icon("refresh-cw") + "再同期")}${action("logout", icon("log-out") + "ログアウト")}<p class="field-hint">${syncState === "error" ? "接続を確認して再同期してください。" : "本と映画の記録をSupabaseに保存しています。非公開記録は本人だけが取得できます。"}</p></div>`);
    return;
  }
  if (viewer === "guest") {
    showModal("アカウント", `<div class="row account-identity">${avatar(mine())}<div><strong>ゲスト</strong><p class="muted">この端末内に保存</p></div></div><div class="stack">${action("business-contact", icon("mail") + "製作者へのお問い合わせ")}${action("goal", icon("chart-no-axes-combined") + "読書目標と実績")}${googleLoginButton()}${action("logout", icon("log-out") + "終了する")}<p class="field-hint">Googleログイン後に、端末の記録を選んでクラウドへ取り込めます。この端末の記録は削除しません。</p></div>`);
    return;
  }
  showModal(
    "アカウント",
    `<div class="row" style="margin-bottom:18px">${avatar(mine())}<div><strong>${esc(mine().name)}</strong><p class="muted">デモアカウント</p></div></div><div class="stack">${action("business-contact", icon("mail") + "製作者へのお問い合わせ")}<a class="btn" data-close href="#/user/${viewer}">${icon("user-round")}プロフィールを見る</a>${action("goal", icon("chart-no-axes-combined") + "読書目標と実績")}<hr style="border:0;border-top:1px solid var(--line);width:100%;margin:0"><h3>デモユーザーを切り替える</h3><div class="stack" style="gap:7px">${store.data.users
      .filter((u) => u.id !== viewer)
      .map(
        (u) =>
          `<button class="demo-user" data-action="login" data-id="${u.id}">${avatar(u)}<strong>${esc(u.name)}</strong>${icon("arrow-right")}</button>`,
      )
      .join(
        "",
      )}</div>${googleLoginButton()}${action("logout", icon("log-out") + "ログアウト")}<p class="field-hint">公開範囲はモック上の表示制御です。本番の認証・アクセス制御ではありません。データはこのブラウザ内にのみ保存されます。デモの棚はGoogleアカウントには移行されません。</p></div>`,
  );
}
function shareUrl(path) {
  const u = new URL(location.href);
  u.search = "";
  if (authState.user) u.searchParams.set("cloud", "1"); else u.searchParams.delete("cloud");
  u.hash = path;
  return u.href;
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("共有URLをコピーしました");
  } catch {
    const input = $("#share-url");
    if (input) {
      input.focus();
      input.select();
      toast("コピーできませんでした。URLを選択しました");
    } else toast("クリップボードを利用できません");
  }
}
function openShare(recordId, selection = {}) {
  if (viewer === "guest") { showModal("共有にはGoogleログインが必要です", `<p>Googleログイン後、端末の記録をクラウドへ取り込んで共有できます。</p>${googleLoginButton()}`); return; }
  const r = recordId ? store.get(recordId, viewer) : null;
  if (recordId && (!r || r.visibility === "private"))
    return toast("非公開の記録は共有できません");
  const c = shelfContext(),
    owner = user(selection.owner || c.owner) || mine(),
    type = selection.type || (labels[c.type] ? c.type : view.type);
  if (r) {
    const url = shareUrl(`/record/${r.id}`);
    showModal(
      "この記録を共有",
      `<div class="share-preview"><span class="muted">${esc(user(r.userId).name)}の記録</span><h3>${esc(r.work.title)}</h3>${stars(r.rating)}${r.spoiler ? '<p class="muted">ネタバレを含む感想は、共有先で操作するまで表示されません。</p>' : r.review ? `<p>${esc(r.review)}</p>` : ""}</div><label>共有URL<input id="share-url" class="share-url" readonly value="${esc(url)}"></label><div class="dialog-actions">${action("copy-url", icon("copy") + "URLをコピー", `data-url="${esc(url)}"`, "btn primary")}</div><p class="share-meta">閲覧にはログインが必要です。このブラウザ内のデモデータを共有します。別端末へ変更は同期されません。</p>`,
    );
  } else
    showModal(
      "棚を共有",
      `<p class="muted" style="margin-bottom:20px">${esc(owner.name)}さんの公開された作品だけを共有します。</p><div class="search-type">${["book", "movie"].map((t) => action("share-type", icon(t === "book" ? "book-open" : "clapperboard") + (t === "book" ? "本の棚" : "映画の棚"), `data-type="${t}" data-owner="${owner.id}"`, t === type ? "btn active" : "btn")).join("")}</div><div class="share-options">${[
        "done",
        "want",
      ]
        .map((s) => {
          const url = shareUrl(`/share/${owner.id}/${type}/${s}`);
          return action(
            "copy-url",
            icon("copy") + labels[type][s] + "リストのURLをコピー",
            `data-url="${esc(url)}"`,
          );
        })
        .join(
          "",
        )}</div><p class="share-meta">閲覧にはログインが必要です。非公開作品は含まれません。別端末へこのブラウザでの変更は同期されません。</p>`,
    );
  if (store.mode === "cloud") $(".share-meta").textContent = "共有先でもGoogleログインが必要です。非公開の記録は含まれません。";
}
function openGoal() {
  const count = monthCount(),
    goal = store.data.goals[viewer] || 5;
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      month: d.getMonth() + 1,
      value: store
        .visible(viewer, viewer)
        .filter(
          (r) =>
            r.work.type === "book" &&
            r.status === "done" &&
            r.completedAt?.startsWith(prefix),
        ).length,
    };
  });
  const max = Math.max(1, ...months.map((m) => m.value));
  showModal(
    "読書目標と実績",
    `<div class="goal-overview"><div class="goal-circle" style="--progress:${Math.min(100, (count / goal) * 100)}%"><strong>${count}/${goal}</strong></div><div><p class="muted">${now.getMonth() + 1}月の読書</p><h3>${count >= goal ? "今月の目標を達成しました" : `あと${goal - count}冊で、今月の目標達成。`}</h3><p class="field-hint">読了日を今月にした本を集計します。</p></div></div><div class="month-chart" aria-label="最近6か月の読了数">${months.map((m) => `<div class="month-bar"><span>${m.value}冊</span><i style="height:${(m.value / max) * 65}px"></i><span>${m.month}月</span></div>`).join("")}</div><form id="goal-form" style="margin-top:25px" novalidate><label>毎月の目標冊数<input type="number" name="goal" min="1" max="99" step="1" value="${goal}" required></label><div class="error" id="goal-error" role="alert"></div><div class="dialog-actions"><button type="submit" class="btn primary">${icon("check")}目標を保存</button></div></form>`,
  );
}

document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    const main = $("#main");
    main.tabIndex = -1;
    main.focus();
    return;
  }
  const b = event.target.closest("[data-action]");
  if (event.target.closest("[data-close]")) closeModal();
  if (!b) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  const currentStore = store, requester = viewer, generation = accountVersion;
  const sameAccount = () => store === currentStore && viewer === requester && generation === accountVersion;
  if (b.dataset.pending) return;
  const mutating = ["confirm-delete", "follow", "like", "confirm-delete-comment", "cloud-refresh", "cloud-retry"].includes(a);
  if (mutating) { b.dataset.pending = "true"; b.disabled = true; }
  try {
    if (a === "close") closeModal();
    else if (a === "login") setSession(id);
    else if (a === "guest-login") setSession("guest");
    else if (a === "cloud-retry") await startCloud(authState.user);
    else if (a === "cloud-refresh") { await currentStore.refresh(); if (!sameAccount()) return; await currentStore.ensureRoute(route()); if (!sameAccount()) return; render(); if (modal.open && b.isConnected) openAccount(); toast("最新の記録を読み込みました"); }
    else if (a === "import-local") openImport();
    else if (a === "logout") {
      if (authState.user) await auth.signOut();
      else setSession("");
    }
    else if (a === "google-login") {
      localStorage.removeItem(SESSION_KEY);
      if (!authState.user) setSession("");
      await auth.signIn(route());
    }
    else if (a === "auth-register") {
      authMode = "register";
      render();
    } else if (a === "auth-login") {
      authMode = "login";
      render();
    } else if (a === "account") openAccount();
    else if (a === "business-contact") { closeModal(); const contact=document.getElementById("readtrace-business-contact"); const details=contact?.querySelector("details"); if(details){details.open=true;contact.scrollIntoView({block:"center",behavior:"smooth"});details.querySelector("summary")?.focus();} }
    else if (a === "goal") openGoal();
    else if (a === "add") openSearch();
    else if (a === "search-books") { view.type = "book"; openSearch(); }
    else if (a === "work-detail") openWorkDetail(works.get(id));
    else if (a === "discover-more") {
      const section = discoverySections.find((s) => s.id === b.dataset.section);
      view.type = "book"; searchType = "book"; searchField = "all"; searchOrder = section.order || "relevance"; searchQuery = section.query; openSearch(false);
    }
    else if (a === "discover-retry") { discoveryCache.delete(b.dataset.section); render(); }
    else if (a === "search-more") { searchPage++; void renderCatalog(true); }
    else if (a === "search-retry") void renderCatalog();
    else if (a === "reset-shelf-filters") { view.ratingFilter = "all"; view.addedAfter = ""; view.query = ""; view.filter = "all"; render(); }
    else if (a === 'shelf-view') {
      shelfView = b.dataset.view;
      localStorage.setItem('readtrace:shelf-view:v1', shelfView);
      renderShelfGrid();
    }
    else if (a === 'orbit-prev') orbitController?.step(-1);
    else if (a === 'orbit-next') orbitController?.step(1);
    else if (a === 'orbit-spin') orbitController?.rotate();
    else if (a === "shelf-type") {
      const c = shelfContext();
      view.type = b.dataset.type;
      view.filter = "all";
      view.query = "";
      view.ratingFilter = "all";
      view.addedAfter = "";
      if (c.shared) navigate(`/share/${c.owner}/${view.type}/${c.shared}`);
      else render();
    } else if (a === "filter") {
      view.filter = b.dataset.filter;
      render();
    } else if (a === "search-type") {
      searchType = b.dataset.type;
      openSearch(false);
    } else if (a === "manual")
      openEditor(
        {
          id: crypto.randomUUID(),
          type: searchType,
          title: searchQuery,
          creator: "",
          image: "",
        },
        null,
        true,
      );
    else if (a === "select-work") selectWork(works.get(id));
    else if (a === "edit") {
      const r = store.get(id, viewer);
      if (r?.userId === viewer)
        openEditor(r.work, r, !catalog.some((w) => w.id === r.work.id));
    } else if (a === "save-work") {
      const r = store.get(id, viewer);
      if (r) selectWork(r.work);
    } else if (a === "delete-record") {
      const r = store.get(id, viewer);
      if (r?.userId === viewer)
        showModal(
          "記録を削除しますか？",
          `<p>「${esc(r.work.title)}」の評価・感想も削除されます。</p><div class="dialog-actions">${action("edit", "キャンセル", `data-id="${id}"`)}${action("confirm-delete", "削除する", `data-id="${id}"`, "btn danger")}</div>`,
        );
    } else if (a === "confirm-delete") {
      await store.remove(id, viewer);
      if (!sameAccount() || !b.isConnected) return;
      closeModal();
      navigate("/shelf");
      toast("記録を削除しました");
    } else if (a === "follow") {
      await store.follow(viewer, id);
      if (!sameAccount()) return;
      const focusId = id;
      const wasModal = modal.open;
      render();
      if (wasModal) openAccount();
      document
        .querySelector(`[data-action="follow"][data-id="${focusId}"]`)
        ?.focus();
    } else if (a === "like") {
      await store.like(viewer, id);
      if (!sameAccount()) return;
      render();
      document.querySelector(`[data-action="like"][data-id="${id}"]`)?.focus();
    } else if (a === "reveal") {
      revealed.add(id);
      render();
    } else if (a === "delete-comment") {
      showModal(
        "コメントを削除しますか？",
        `<p>自分のコメントを削除します。</p><div class="dialog-actions">${action("close", "キャンセル")}${action("confirm-delete-comment", "削除する", `data-id="${id}"`, "btn danger")}</div>`,
      );
    } else if (a === "confirm-delete-comment") {
      await store.removeComment(viewer, id);
      if (!sameAccount() || !b.isConnected) return;
      closeModal();
      render();
      toast("コメントを削除しました");
    } else if (a === "share-record") openShare(id);
    else if (a === "share-shelf") openShare();
    else if (a === "share-type") {
      openShare(null, { type: b.dataset.type, owner: b.dataset.owner });
    } else if (a === "copy-url") copy(b.dataset.url);
  } catch (error) {
    if (sameAccount()) toast(error.message);
  } finally {
    if (mutating && b.isConnected) { delete b.dataset.pending; b.disabled = false; }
  }
});
document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "shelf-search") {
    view.query = target.value;
    renderShelfGrid();
  }
  if (target.id === "catalog-search") {
    searchQuery = target.value;
    searchController?.abort();
    searchVersion++;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void renderCatalog(), 450);
  }
  if (target.id === "people-search") {
    let shown = 0;
    document.querySelectorAll(".user-card").forEach((el) => {
      el.hidden = !el.dataset.name.includes(target.value.toLocaleLowerCase());
      if (!el.hidden) shown++;
    });
    $("#people-empty").hidden = shown !== 0;
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "rating-filter") { view.ratingFilter = event.target.value; renderShelfGrid(); }
  if (event.target.id === "added-after") { view.addedAfter = event.target.value; renderShelfGrid(); }
  if (event.target.id === "catalog-field") { searchField = event.target.value; void renderCatalog(); }
  if (event.target.id === "shelf-sort") {
    view.sort = event.target.value;
    renderShelfGrid();
  }
  if (event.target.id === "no-rating") ratingUpdate();
  if (event.target.matches('#rating-picker input[name="rating"]')) { $("#no-rating").checked = false; ratingUpdate(); }
  if (event.target.id === "edit-status")
    $("#rating-required").textContent =
      event.target.value === "done" ? "必須" : "任意";
  if (event.target.id === "edit-type") {
    editing.work.type = event.target.value;
    modal.dataset.media = event.target.value;
    if ($("#manual-isbn-label")) $("#manual-isbn-label").hidden = event.target.value !== "book";
    $('input[name="creator"]').closest("label").firstChild.textContent =
      event.target.value === "book" ? "著者 " : "監督 ";
    $("#edit-status").innerHTML = Object.entries(labels[event.target.value])
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join("");
    $("#rating-required").textContent = "任意";
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (
    !["register-form", "record-form", "comment-form", "goal-form", "import-form"].includes(
      form.id,
    )
  )
    return;
  event.preventDefault();
  if (form.dataset.saving) return;
  form.dataset.saving = "true";
  const submitter = form.querySelector('[type="submit"]');
  if (submitter) { submitter.disabled = true; submitter.setAttribute("aria-busy", "true"); }
  const currentStore = store, requester = viewer, generation = accountVersion;
  const sameForm = () => store === currentStore && viewer === requester && generation === accountVersion && form.isConnected;
  const data = new FormData(form);
  try {
    if (form.id === "register-form") {
      const u = demoStore.register(String(data.get("name") || ""));
      authMode = "login";
      setSession(u.id);
      toast("あなたの棚をつくりました");
    }
    if (form.id === "record-form") {
      let work = { ...editing.work };
      if (editing.manual) {
        const image = String(data.get("image") || "").trim();
        if (image && !/^https?:\/\//i.test(image))
          throw new Error("画像URLはhttp://またはhttps://で入力してください。");
        work = {
          ...work,
          type: data.get("type"),
          title: data.get("title"),
          creator: data.get("creator"),
          image,
        };
        const isbnInput = String(data.get("isbn") || "").trim();
        if (work.type === "book" && isbnInput && !canonicalIsbn(isbnInput)) throw new Error("ISBNは有効な10桁または13桁で入力してください。");
        work.isbn13 = work.type === "book" ? canonicalIsbn(isbnInput) : "";
        work.isbn = work.isbn13;
      }
      const r = await store.save(
        {
          ...editing.record,
          work,
          status: data.get("status"),
          rating: $("#no-rating").checked
            ? null
            : Number(data.get("rating")),
          review: String(data.get("review") || ""),
          spoiler: data.has("spoiler"),
          visibility: data.get("visibility"),
          completedAt: String(data.get("completedAt") || ""),
          startedAt: String(data.get("startedAt") || ""),
        },
        viewer,
      );
      if (!sameForm()) return;
      view.type = r.work.type;
      view.filter = "all";
      view.query = "";
      if (!editing.record) { view.ratingFilter = "all"; view.addedAfter = ""; }
      closeModal();
      if (editing.record) render();
      else navigate("/shelf");
      toast("記録を保存しました");
    }
    if (form.id === "comment-form") {
      await store.comment(viewer, form.dataset.id, String(data.get("comment") || ""));
      if (!sameForm()) return;
      render();
      toast("コメントを投稿しました");
    }
    if (form.id === "goal-form") {
      await store.goal(viewer, Number(data.get("goal")));
      if (!sameForm()) return;
      closeModal();
      render();
      toast("月間目標を保存しました");
    }
    if (form.id === "import-form") {
      const selected = data.getAll("source");
      if (!selected.length) throw new Error("取り込む記録を選んでください。");
      const sources = localSources();
      const records = selected.flatMap((key) => sources.find((source) => source.key === key)?.records || []);
      const result = await store.importRecords(records);
      if (!sameForm()) return;
      showModal("取り込み結果", `<p>${result.imported}件を保存しました。重複${result.skipped}件は追加していません。</p>${result.errors.length ? `<div class="error" role="alert">${result.errors.map(esc).join("<br>")}</div>` : ""}<p class="field-hint">元の端末内データは変更していません。</p><div class="dialog-actions">${action("close", "閉じる", "", "btn primary")}</div>`);
      render();
    }
  } catch (error) {
    if (!sameForm()) return;
    const errorNode = $(
      {
        "register-form": "#register-error",
        "record-form": "#record-error",
        "comment-form": "#comment-error",
        "goal-form": "#goal-error",
        "import-form": "#import-error",
      }[form.id],
    );
    if (errorNode && form.isConnected) { errorNode.textContent = error.message; errorNode.tabIndex = -1; errorNode.focus(); }
    else toast(error.message);
  } finally {
    delete form.dataset.saving;
    if (submitter?.isConnected) { submitter.disabled = false; submitter.removeAttribute("aria-busy"); }
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.matches(".tab") &&
    ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
  ) {
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".tab")];
    const index = tabs.indexOf(event.target);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[next].click();
    document.querySelectorAll(".tab")[next]?.focus();
  }
});
function localSources() {
  const sources = [];
  const guest = guestStore.data.records.filter((r) => r.userId === "guest");
  if (guest.length) sources.push({ key: "guest", label: "ゲストの記録", records: guest });
  if (authState.user) {
    try {
      const old = JSON.parse(localStorage.getItem(`readtrace:account:${authState.user.id}:v1`));
      const records = old?.records?.filter((r) => r.userId === authState.user.id) || [];
      if (records.length) sources.push({ key: "account", label: "以前このGoogleアカウントで端末に保存した記録", records });
    } catch {}
  }
  for (const u of demoStore.data.users) {
    const records = demoStore.data.records.filter((r) => r.userId === u.id);
    if (records.length) sources.push({ key: `demo:${u.id}`, label: `デモ棚: ${u.name}`, records });
  }
  return sources;
}
function openImport() {
  if (store.mode !== "cloud") return;
  const sources = localSources();
  showModal("端末の記録を取り込む", sources.length ? `<p class="muted">取り込む棚を選んでください。元データは削除しません。</p><form id="import-form" class="stack" novalidate>${sources.map((source) => `<label class="check-label"><input type="checkbox" name="source" value="${esc(source.key)}">${esc(source.label)} (${source.records.length}件)</label>`).join("")}<p class="field-hint">選んだ棚の本・映画・評価・感想・日付・公開範囲を、このGoogleアカウントへ保存します。同じISBNなどの重複作品は追加しません。</p><div class="error" id="import-error" role="alert"></div><div class="dialog-actions">${action("close", "キャンセル")}<button class="btn primary" type="submit">${icon("import")}選んだ記録を取り込む</button></div></form>` : '<p>この端末に取り込める記録はありません。</p>');
}
async function startCloud(identity) {
  if (!identity) return;
  const version = ++accountVersion;
  store.dispose?.();
  store = createStore({ getItem: () => null, setItem() {} }, { seed: () => emptyAccountData(identity) });
  viewer = identity.id;
  cloudLoading = true; cloudFailure = "";
  closeModal(); render();
  const candidate = createCloudStore(auth.client, identity, {
    onChange: () => {
      if (version !== accountVersion || store !== candidate || cloudLoading) return;
      candidate.data.records.forEach((r) => works.set(r.work.id, r.work));
      render();
      const path = route();
      if (/^\/(?:record|share|user)\//.test(path)) void candidate.ensureRoute(path).then(() => { if (store === candidate && path === route()) render(); }).catch(() => {});
    },
    onSync: (state) => {
      if (version !== accountVersion) return;
      syncState = state;
      const button = $('.cloud-status');
      if (button) { button.innerHTML = icon(state === "error" ? "cloud-off" : "cloud"); button.title = state === "error" ? "接続を確認して再同期" : state === "syncing" ? "同期中" : "クラウド保存"; button.setAttribute("aria-label", button.title); icons(); }
    },
  });
  try {
    await candidate.init();
    await candidate.ensureRoute(route());
    if (version !== accountVersion) { candidate.dispose(); return; }
    store = candidate;
    cloudLoading = false;
    candidate.data.records.forEach((r) => works.set(r.work.id, r.work));
    candidate.subscribe(); render();
    const offerKey = `readtrace:import-offered:${identity.id}`;
    if (!sessionStorage.getItem(offerKey) && localSources().some((s) => ["guest", "account"].includes(s.key))) {
      sessionStorage.setItem(offerKey, "1");
      openImport();
    }
  } catch (error) {
    candidate.dispose();
    if (version !== accountVersion) return;
    cloudLoading = false; cloudFailure = error.message; render();
  }
}
const auth = createAuth({
  config: authConfig,
  storage: sessionStorage,
  location,
  replaceUrl: (url) => history.replaceState(null, "", url),
  checkProvider: async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`${authConfig.url}/auth/v1/settings`, { headers: { apikey: authConfig.publishableKey }, signal: controller.signal });
      if (!response.ok) throw new Error("Auth settings unavailable");
      return (await response.json()).external?.google === true;
    } finally { clearTimeout(timer); }
  },
  createClient: async (...args) => {
    if (!window.supabase) await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("./assets/supabase-2.119.0.js", import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error("network SDK load failed"));
      document.head.append(script);
    });
    return window.supabase.createClient(...args);
  },
  onChange: (next) => {
    const changed = next.user?.id !== authState.user?.id;
    authState = next;
    if (next.user && changed) {
      localStorage.removeItem(SESSION_KEY);
      revealed.clear();
      void startCloud(next.user);
    } else if (!next.user && changed) {
      accountVersion++;
      store.dispose?.();
      store = demoStore;
      viewer = "";
      cloudLoading = false; cloudFailure = "";
      revealed.clear();
      closeModal();
    } else if (!next.user && next.ready && !viewer) {
      const savedDemo = localStorage.getItem(SESSION_KEY);
      if (savedDemo === "guest") { viewer = "guest"; store = guestStore; }
      else if (demoStore.data.users.some((u) => u.id === savedDemo)) viewer = savedDemo;
    }
    if (changed || !viewer || !document.querySelector(".shell")) render();
  },
});
render();
void auth.init();
