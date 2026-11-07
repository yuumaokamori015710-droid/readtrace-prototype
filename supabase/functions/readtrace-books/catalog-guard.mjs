const DAY = 86400;
const PROVIDERS = new Map([
  ["www.googleapis.com", "google"], ["openlibrary.org", "openlibrary"],
  ["ndlsearch.ndl.go.jp", "ndl"], ["itunes.apple.com", "itunes"], ["www.wikidata.org", "wikidata"],
]);

export class CatalogError extends Error {
  constructor(message, status = 503, retryAfter = 30) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

export function sharedTtl(headers, provider, now = Date.now()) {
  const control = headers.get("cache-control") || "";
  if (/\b(no-store|no-cache|private)\b/i.test(control)) return 0;
  const age = Math.max(0, Number(headers.get("age")) || 0);
  const maxAge = control.match(/(?:^|,)\s*s-maxage\s*=\s*"?(\d+)/i) || control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i);
  if (maxAge) return Math.max(0, Math.min(DAY, Number(maxAge[1]) - age));
  const expires = Date.parse(headers.get("expires") || "");
  if (Number.isFinite(expires)) return Math.max(0, Math.min(DAY, Math.floor((expires - now) / 1000)));
  // Google permits caching only for the lifetime specified by its response headers.
  return provider === "google" ? 0 : 21600;
}

export function cacheIdentity(value) {
  const url = new URL(value);
  url.searchParams.delete("key"); url.searchParams.delete("quotaUser");
  for (const [key, value] of url.searchParams) url.searchParams.set(key, value.normalize("NFKC"));
  url.searchParams.sort();
  return `v1:${url.href}`;
}

export function createCatalogRpc({ url, serviceKey, fetcher = fetch }) {
  return async (name, args) => {
    if (!serviceKey) throw new CatalogError("検索サービスの保護設定を確認してください。");
    const response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: serviceKey, ...(serviceKey.startsWith("eyJ") ? { Authorization: `Bearer ${serviceKey}` } : {}), "Content-Type": "application/json" },
      body: JSON.stringify(args), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new CatalogError("検索サービスが混み合っています。少し待って再試行してください。");
    return response.json();
  };
}

export async function digest(value, secret = "") {
  const bytes = new TextEncoder().encode(value);
  const hash = secret ? await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), bytes) : await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
}

export function createCatalogTransport({ rpc, fetcher = fetch, pending = new Map(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const stats = { hits: 0, misses: 0, blocked: 0, googleTtl: null, ttl: DAY };
  async function load(value, options) {
    const url = new URL(value), provider = PROVIDERS.get(url.hostname);
    if (!provider) throw new CatalogError("未対応の書誌サービスです。");
    const key = await digest(cacheIdentity(url));
    let claim;
    for (let attempt = 0; attempt < 7; attempt++) {
      claim = await rpc("readtrace_catalog_claim", { p_key: key, p_provider: provider });
      if (claim.state !== "pending") break;
      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await pause(300);
    }
    if (claim.state === "hit") { stats.hits++; return { ...claim.payload, ttl: claim.ttl }; }
    if (claim.state !== "miss") {
      stats.blocked++;
      return { body: "{}", status: 503, headers: { "content-type": "application/json" }, ttl: 0 };
    }
    stats.misses++;
    let payload = null, ttl = 0, block = "";
    try {
      const response = await fetcher(url, options);
      if (!response.ok) console.warn(JSON.stringify({ event: "catalog_upstream_status", provider, status: response.status }));
      const body = await response.text();
      const headers = { "content-type": response.headers.get("content-type") || "application/json" };
      const result = { body, status: response.status, headers, ttl: 0 };
      let json; if (provider !== "ndl") { try { json = JSON.parse(body); } catch { json = null; } }
      if (response.ok && json?.error) return { ...result, status: 503 };
      if (response.ok) {
        ttl = sharedTtl(response.headers, provider);
        if (provider === "google") stats.googleTtl = ttl;
        if (/"(?:items|docs|results)"\s*:\s*\[\s*\]/.test(body)) ttl = Math.min(ttl, 300);
        const candidate = { body, status: response.status, headers };
        if (new TextEncoder().encode(JSON.stringify(candidate)).length <= 128000) payload = candidate;
        result.ttl = ttl;
      } else if (provider === "google" && [403, 429].includes(response.status)) {
        block = /Queries per day|perDay|dailyLimitExceeded|defaultPerDay/i.test(body) ? "day" : "minute";
      }
      return result;
    } finally {
      // If persistence fails, do not retry the upstream or silently bypass the budget.
      await rpc("readtrace_catalog_finish", { p_key: key, p_token: claim.token, p_payload: ttl > 0 ? payload : null, p_ttl: ttl, p_block: block });
    }
  }
  return {
    stats,
    async fetch(value, options) {
      const key = cacheIdentity(value);
      if (!pending.has(key)) pending.set(key, load(value, options).finally(() => pending.delete(key)));
      const result = await pending.get(key);
      stats.ttl = Math.min(stats.ttl, result.ttl);
      if (PROVIDERS.get(new URL(value).hostname) === "google") stats.googleTtl = result.ttl;
      return new Response(result.body, { status: result.status, headers: { ...result.headers, "x-readtrace-cache-ttl": String(result.ttl) } });
    },
  };
}
