export const RETURN_KEY = "readtrace:oauth-return:v1";

export function safeReturnRoute(value) {
  return /^\/(?:shelf|feed|people|user\/[\w-]+|record\/[\w-]+|share\/[\w-]+\/(?:book|movie)\/(?:done|want))$/.test(value || "")
    ? value : "/shelf";
}

export function callbackUrl(href) {
  const url = new URL(href);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new Error("ログインにはHTTPS、またはローカル開発環境が必要です。");
  url.search = "";
  url.hash = "";
  return url.href;
}

export function cleanCallbackUrl(href) {
  const url = new URL(href);
  for (const key of ["code", "error", "error_code", "error_description", "state"]) url.searchParams.delete(key);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (["error", "error_code", "access_token", "refresh_token"].some((key) => fragment.has(key))) url.hash = "";
  return url.href;
}

export function authError(error) {
  const value = `${error?.code || ""} ${error?.message || ""}`;
  if (/provider.*not.*enabled|unsupported_provider/i.test(value)) return "Google認証がまだ有効になっていません。管理者の設定完了後にお試しください。";
  if (/access_denied/i.test(value)) return "Googleログインをキャンセルしました。もう一度お試しいただけます。";
  if (/flow_state|code_verifier|expired|invalid.*code/i.test(value)) return "ログインの有効期限が切れました。このブラウザからもう一度ログインしてください。";
  if (/fetch|network|offline/i.test(value)) return "認証サーバーに接続できません。ネット接続を確認して再度お試しください。";
  return "Googleログインを完了できませんでした。もう一度お試しください。";
}

export function emptyAccountData(identity) {
  const name = String(identity.user_metadata?.full_name || identity.user_metadata?.name || "読書家").trim().slice(0, 30) || "読書家";
  return {
    version: 2,
    users: [{ id: identity.id, name, bio: "", initial: Array.from(name)[0], color: "#536e60" }],
    records: [], follows: [], likes: [], comments: [], goals: { [identity.id]: 5 },
  };
}

export function createAuth({ config, storage, location, replaceUrl, createClient, onChange = () => {} }) {
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url || "") && Boolean(config.publishableKey);
  let client, initialization, generation = 0;
  let state = { ready: false, configured: configured && config.googleEnabled === true, googleEnabled: configured && config.googleEnabled === true, user: null, busy: false, error: "" };
  const publish = (next) => { state = { ...state, ...next }; onChange(state); };
  const verify = async () => {
    const current = ++generation;
    const { data, error } = await client.auth.getUser();
    if (current !== generation) return;
    if (error) {
      publish({ user: null, error: authError(error) });
      await client.auth.signOut({ scope: "local" });
      return;
    }
    publish({ user: data.user || null, error: "" });
  };
  return {
    get state() { return state; },
    init() {
      if (initialization) return initialization;
      initialization = (async () => {
        if (!configured) { publish({ ready: true }); return; }
        try {
          client = await createClient(config.url, config.publishableKey, {
            auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: "readtrace:supabase-auth:v1" },
          });
          const url = new URL(location.href);
          const code = url.searchParams.get("code");
          const fragment = new URLSearchParams(url.hash.slice(1));
          const callbackError = url.searchParams.get("error_code") || url.searchParams.get("error") || fragment.get("error_code") || fragment.get("error") || (fragment.has("access_token") ? "flow_state_invalid" : "");
          if (code || callbackError) {
            const target = new URL(cleanCallbackUrl(url.href));
            target.hash = safeReturnRoute(storage.getItem(RETURN_KEY) || url.hash.slice(1));
            replaceUrl(target.href);
          }
          if (callbackError) throw { code: callbackError };
          if (code) {
            const { error } = await client.auth.exchangeCodeForSession(code);
            if (error) throw error;
          }
          const { data, error } = await client.auth.getSession();
          if (error) throw error;
          if (data.session) await verify();
          if (code && state.user) {
            const destination = safeReturnRoute(storage.getItem(RETURN_KEY));
            storage.removeItem(RETURN_KEY);
            const target = new URL(location.href);
            target.hash = destination;
            replaceUrl(target.href);
          }
          client.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") { generation++; publish({ user: null }); }
            // Do not call other Supabase methods inside the auth callback's lock.
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") queueMicrotask(() => verify().catch((error) => publish({ user: null, error: authError(error) })));
          });
        } catch (error) { publish({ user: null, error: authError(error) }); }
        finally { publish({ ready: true, busy: false }); }
      })();
      return initialization;
    },
    async signIn(route) {
      if (!client || !state.googleEnabled) throw new Error("Googleログインの接続設定を準備中です。デモは引き続き利用できます。");
      if (state.busy) return;
      publish({ busy: true, error: "" });
      try {
        storage.setItem(RETURN_KEY, safeReturnRoute(route));
        const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl(location.href), queryParams: { prompt: "select_account" } } });
        if (error) throw error;
      } catch (error) { publish({ busy: false, error: authError(error) }); }
    },
    async signOut() {
      generation++;
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new Error("ログアウトできませんでした。ネット接続を確認して再度お試しください。");
      storage.removeItem(RETURN_KEY);
      publish({ user: null, busy: false, error: "" });
    },
  };
}
