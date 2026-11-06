import { XMLParser } from "npm:fast-xml-parser@5.12.0";
import { createBookProvider } from "./books.mjs";

const allowedOrigins = new Set([
  "https://yuumaokamori015710-droid.github.io",
  "http://127.0.0.1:8011", "http://localhost:8011",
  "http://127.0.0.1:8012", "http://localhost:8012",
  "http://127.0.0.1:8013", "http://localhost:8013",
]);
// This public project identifier is not a user credential or a service-role key.
// This endpoint returns external book metadata only and never reads user tables.
const clientKey = Deno.env.get("READTRACE_PUBLISHABLE_KEY") || "sb_publishable_CmXbWEbuTHkTm38BCK7Hiw_j0TaNR6u";
const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, processEntities: false });
const provider = createBookProvider({
  googleKey: Deno.env.get("GOOGLE_BOOKS_API_KEY") || "",
  parseXml(xml: string) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported XML document");
    return parser.parse(xml);
  },
});
const requests = new Map<string, { count: number; expires: number }>();

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://yuumaokamori015710-droid.github.io",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowedOrigins.has(origin)) return reply({ error: "この配信元からは利用できません。" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "POSTで検索してください。" }, 405);
  if (request.headers.get("apikey") !== clientKey) return reply({ error: "アプリの接続設定を確認してください。" }, 401);
  const now = Date.now();
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].slice(0, 80);
  const quota = requests.get(ip);
  if (quota && quota.expires > now && quota.count >= 30) return reply({ error: "検索が集中しています。少し待って再検索してください。" }, 429);
  requests.set(ip, quota && quota.expires > now ? { ...quota, count: quota.count + 1 } : { count: 1, expires: now + 60000 });
  if (requests.size > 1000) for (const [key, value] of requests) if (value.expires <= now) requests.delete(key);
  try {
    const body = await request.text();
    if (body.length > 4096) return reply({ error: "検索条件が長すぎます。" }, 400);
    const input = JSON.parse(body);
    if (typeof input.query !== "string" || input.query.length > 160) return reply({ error: "検索語は160文字以内で入力してください。" }, 400);
    const result = input.type === "movie" ? await provider.movies(input) : await provider.search(input);
    return reply(result);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? "検索条件を確認してください。" : "書誌データを取得できませんでした。再検索するか、手入力で追加してください。" }, 502);
  }
});
