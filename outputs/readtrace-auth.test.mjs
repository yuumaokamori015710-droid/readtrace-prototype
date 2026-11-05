import test from "node:test";
import assert from "node:assert/strict";
import { createAuth, callbackUrl, cleanCallbackUrl, safeReturnRoute, emptyAccountData, RETURN_KEY } from "./readtrace-auth.mjs";
import { createStore } from "./readtrace-store.mjs";

const memory = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const identity = { id: "6ad90999-152a-4b63-9da2-5217210a07e1", user_metadata: { full_name: "テスト読者" } };
function setup({ href = "https://example.github.io/readtrace/reading-prototype.html", session = null, userError = null, exchangeError = null, loginError = null, config } = {}) {
  const storage = memory(), calls = [], location = { href };
  let listener;
  const client = { auth: {
    getSession: async () => ({ data: { session } }),
    getUser: async () => { calls.push("verify"); return { data: { user: userError ? null : identity }, error: userError }; },
    exchangeCodeForSession: async (code) => { calls.push(["exchange", code]); session = exchangeError ? null : {}; return { error: exchangeError }; },
    signInWithOAuth: async (options) => { calls.push(options); return { error: loginError }; },
    signOut: async (options) => { calls.push(["logout", options]); listener?.("SIGNED_OUT"); return {}; },
    onAuthStateChange: (fn) => { listener = fn; },
  } };
  const auth = createAuth({
    config: config || { url: "https://testproject.supabase.co", publishableKey: "sb_publishable_example", googleEnabled: true },
    storage, location, replaceUrl: (value) => { location.href = value; },
    createClient: async (url, key, options) => { calls.push(options); return client; },
  });
  return { auth, calls, location, storage, event: (name) => listener(name) };
}

test("return route only permits known internal routes", () => {
  for (const value of ["https://evil.example", "//evil.example", "/shelf?redirect=https://evil.example", "/share/a/movie/private", "/record/%0a"]) assert.equal(safeReturnRoute(value), "/shelf");
  assert.equal(safeReturnRoute("/share/user-1/book/done"), "/share/user-1/book/done");
});
test("callback is the exact deployed HTML, with no query or hash", () => {
  assert.equal(callbackUrl("https://user.github.io/app/reading-prototype.html?release=2#/record/a"), "https://user.github.io/app/reading-prototype.html");
  assert.equal(callbackUrl("http://127.0.0.1:8011/reading-prototype.html#/shelf"), "http://127.0.0.1:8011/reading-prototype.html");
  assert.throws(() => callbackUrl("http://remote.example/app"));
});
test("OAuth code and error parameters are removed, other parameters survive", () => {
  assert.equal(cleanCallbackUrl("https://example.com/app?code=secret&error=denied&error_code=x&error_description=y&state=z&release=3#/shelf"), "https://example.com/app?release=3#/shelf");
});
test("unconfigured auth does not create a client or pretend to log in", async () => {
  const { auth, calls } = setup({ config: {} });
  await auth.init();
  assert.equal(auth.state.ready, true);
  assert.equal(auth.state.user, null);
  assert.equal(calls.length, 0);
  await assert.rejects(auth.signIn("/shelf"), /準備中/);
});
test("Google login uses PKCE, least-scope OAuth and saves destination", async () => {
  const { auth, calls, storage } = setup();
  await auth.init();
  assert.equal(calls[0].auth.flowType, "pkce");
  assert.equal(calls[0].auth.detectSessionInUrl, false);
  await auth.signIn("/record/abc");
  assert.equal(storage.getItem(RETURN_KEY), "/record/abc");
  assert.equal(calls[1].provider, "google");
  assert.equal(calls[1].options.redirectTo, "https://example.github.io/readtrace/reading-prototype.html");
  assert.equal(calls[1].options.scopes, undefined);
});
test("callback exchanges once, verifies user with server, then restores shared URL", async () => {
  const { auth, calls, location, storage } = setup({ href: "https://example.github.io/readtrace/reading-prototype.html?code=one-use" });
  storage.setItem(RETURN_KEY, "/share/owner/movie/want");
  await Promise.all([auth.init(), auth.init()]);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === "exchange").length, 1);
  assert.equal(calls.includes("verify"), true);
  assert.equal(auth.state.user.id, identity.id);
  assert.equal(new URL(location.href).hash, "#/share/owner/movie/want");
  assert.equal(new URL(location.href).search, "");
  assert.equal(storage.getItem(RETURN_KEY), null);
});
test("cancelled login keeps original destination, hides provider messages", async () => {
  const { auth, location, storage } = setup({ href: "https://example.github.io/readtrace/reading-prototype.html?error=access_denied&error_description=untrusted" });
  storage.setItem(RETURN_KEY, "/record/abc");
  await auth.init();
  assert.match(auth.state.error, /キャンセル/);
  assert.doesNotMatch(auth.state.error, /untrusted/);
  assert.equal(new URL(location.href).hash, "#/record/abc");
  assert.equal(auth.state.user, null);
});
test("expired PKCE code is not accepted as an authenticated session", async () => {
  const { auth, location } = setup({ href: "https://example.com/app?code=old", exchangeError: { code: "flow_state_expired" } });
  await auth.init();
  assert.equal(auth.state.user, null);
  assert.match(auth.state.error, /有効期限/);
  assert.equal(new URL(location.href).search, "");
});
test("Supabase fragment errors are cleaned and restore the original route", async () => {
  const { auth, location, storage } = setup({ href: "https://example.com/app#error=access_denied&error_code=access_denied&error_description=private" });
  storage.setItem(RETURN_KEY, "/share/owner/book/done");
  await auth.init();
  assert.equal(new URL(location.href).hash, "#/share/owner/book/done");
  assert.match(auth.state.error, /キャンセル/);
  assert.equal(auth.state.user, null);
});
test("implicit-flow tokens are removed and are never accepted as a PKCE login", async () => {
  const { auth, location } = setup({ href: "https://example.com/app#access_token=not-a-session&refresh_token=secret" });
  await auth.init();
  assert.equal(auth.state.user, null);
  assert.equal(location.href.includes("secret"), false);
});
test("stored session alone is insufficient; failed server verification clears it", async () => {
  const { auth, calls } = setup({ session: {}, userError: { message: "invalid token" } });
  await auth.init();
  assert.equal(auth.state.user, null);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "logout"), true);
});
test("disabled Google provider gives recoverable Japanese error", async () => {
  const { auth } = setup({ loginError: { message: "Unsupported provider: provider is not enabled" } });
  await auth.init();
  await auth.signIn("/shelf");
  assert.equal(auth.state.busy, false);
  assert.match(auth.state.error, /有効になっていません/);
});
test("logout affects this application session, not all devices", async () => {
  const { auth, calls } = setup({ session: {} });
  await auth.init();
  await auth.signOut();
  assert.equal(auth.state.user, null);
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === "logout")[1], { scope: "local" });
});
test("Google accounts have separate empty shelves, not selectable demo identities", () => {
  const storage = memory();
  const a = createStore(storage, { key: `account:${identity.id}`, seed: () => emptyAccountData(identity) });
  assert.equal(a.data.records.length, 0);
  assert.deepEqual(a.data.users.map((user) => user.id), [identity.id]);
  a.save({ work: { id: "b1", type: "book", title: "自分の本" }, status: "want", rating: null, visibility: "private" }, identity.id);
  const second = { id: "other", user_metadata: {} };
  const b = createStore(storage, { key: "account:other", seed: () => emptyAccountData(second) });
  assert.equal(b.data.records.length, 0);
  assert.equal(createStore(storage, { key: `account:${identity.id}`, seed: () => emptyAccountData(identity) }).data.records.length, 1);
});
