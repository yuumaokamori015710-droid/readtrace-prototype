import { createBookProvider, canonicalIsbn } from "./books.mjs";
import { CatalogError, createCatalogRpc, createCatalogTransport, digest } from "./catalog-guard.mjs";

const origins = new Set([
  "https://yuumaokamori015710-droid.github.io",
  ...[8011, 8012, 8013].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
]);

async function readInput(request) {
  if (Number(request.headers.get("content-length")) > 4096) throw new CatalogError("検索条件が長すぎます。", 400, 0);
  const reader = request.body?.getReader();
  if (!reader) throw new CatalogError("検索条件を入力してください。", 400, 0);
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new CatalogError("検索条件が長すぎます。", 400, 0); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const input = JSON.parse(new TextDecoder().decode(bytes));
  if (!input || typeof input.query !== "string" || !input.query.trim() || input.query.length > 160) throw new CatalogError("検索語は1〜160文字で入力してください。", 400, 0);
  const type = input.type || "book", field = input.field || "all", order = input.order || "relevance";
  if (!["book", "movie"].includes(type) || !["all", "title", "author", "isbn"].includes(field) || !["relevance", "newest"].includes(order)) throw new CatalogError("検索条件を確認してください。", 400, 0);
  const query = input.query.normalize("NFKC").trim();
  if (type === "book" && field === "isbn" && !canonicalIsbn(query)) throw new CatalogError("ISBNはチェック桁を含む10桁または13桁で入力してください。", 400, 0);
  const page = input.page === undefined ? 1 : Number(input.page);
  if (!Number.isInteger(page) || page < 1 || page > 20) throw new CatalogError("検索は1〜20ページの範囲でご利用ください。", 400, 0);
  return { type, query, field, order, page };
}

export function createCatalogHandler({ url, serviceKey, clientKey, googleKey, parseXml, fetcher = fetch, rpc = createCatalogRpc({ url, serviceKey, fetcher }) }) {
  const pending = new Map();
  return async request => {
    const origin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin",
      "Access-Control-Allow-Origin": origin && origins.has(origin) ? origin : "https://yuumaokamori015710-droid.github.io",
      "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Expose-Headers": "Retry-After",
    };
    const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
    if (origin && !origins.has(origin)) return reply({ error: "この配信元からは利用できません。" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply({ error: "POSTで検索してください。" }, 405);
    if (request.headers.get("apikey") !== clientKey) return reply({ error: "アプリの接続設定を確認してください。" }, 401);
    try {
      const input = await readInput(request);
      // Raw IPs, JWTs and Google identities are never written to the cache database.
      const ip = await digest(`ip:${(request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80)}`, serviceKey);
      const preflight = await rpc("readtrace_catalog_preflight", { p_ip: ip });
      if (!preflight.allowed) throw new CatalogError("検索が集中しています。1分ほど待って再検索してください。",429,preflight.retryAfter);
      let userId = "";
      const authorization = request.headers.get("authorization");
      if (authorization) {
        const response = await fetcher(`${url}/auth/v1/user`, { headers: { apikey: clientKey, Authorization: authorization }, signal: AbortSignal.timeout(5000) });
        const user = response.ok ? await response.json() : null;
        if (!user?.id) throw new CatalogError("ログインの有効期限を確認し、もう一度ログインしてください。", 401, 0);
        userId = user.id;
      }
      const actor = userId ? await digest(`user:${userId}`, serviceKey) : ip;
      const gate = await rpc("readtrace_catalog_gate", { p_actor: actor, p_ip: ip, p_authenticated: Boolean(userId) });
      if (!gate.allowed) throw new CatalogError(gate.kind === "day" ? "24時間の検索利用枠に達しました。時間をおいてご利用ください。登録済みの棚は引き続き使えます。" : "検索が集中しています。1分ほど待って再検索してください。", 429, gate.retryAfter);
      const transport = createCatalogTransport({ rpc, fetcher, pending });
      const provider = createBookProvider({ googleKey, parseXml, fetcher: transport.fetch, cacheMs: 0 });
      const result = input.type === "movie" ? await provider.movies(input) : await provider.search(input);
      if (input.type === "book" && input.page === 20) result.hasMore = false;
      return reply({ ...result, cacheTtlSeconds: Math.min(600, transport.stats.ttl), cache: { hits: transport.stats.hits, misses: transport.stats.misses, blocked: transport.stats.blocked, googleTtl: transport.stats.googleTtl } });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : error instanceof CatalogError ? error.status : 502;
      return reply({ error: error instanceof SyntaxError ? "検索条件を確認してください。" : error instanceof CatalogError ? error.message : "書誌データを取得できませんでした。再検索するか、手入力で追加してください。", code: status === 429 ? "SEARCH_RATE_LIMITED" : "SEARCH_UNAVAILABLE" }, status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
    }
  };
}
