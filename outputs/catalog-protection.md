# Catalog Cache and Usage Protection

## Storage and Limits

The existing Supabase Postgres project provides cross-instance cache leases and atomic budgets. No new paid cache, compute service, credential, billing link or plan change is required. `readtrace_catalog_private` is not exposed to browser roles. Its tables have RLS and no browser grants; the narrowly scoped RPCs can only be executed by `service_role`. The function uses a default server-side secret exclusively for these metadata RPCs, never for shelf queries. It is not sent to the browser or read into deployment scripts.

| Scope | Limit |
| --- | --- |
| Before Auth lookup, per IP | 60 requests / minute |
| Verified user | 30 / minute, 200 / 24-hour window |
| Guest network | 30 / minute, 60 / 24-hour window |
| Network backstop | 60 / minute, 500 / 24-hour window |
| Accepted app searches overall | 240 / minute, 5,000 / 24-hour window |
| Google upstream attempts | 40 / minute, 900 / America/Los_Angeles date |
| Apple iTunes upstream attempts | 18 / minute, 3,000 / 24-hour window |
| Other provider upstream attempts | 60 / minute/provider, 3,000 / 24-hour window/provider |

Individual denials do not consume the global search allowance. Authenticated identity comes from Supabase `/auth/v1/user`, not a supplied user ID or decoded unverified JWT. Raw IPs/user IDs/tokens/search phrases are not stored in budget keys: network/user identifiers use keyed SHA-256, and cache URLs have credentials removed before hashing. IP rules are a best-effort backstop, not proof of identity or DDoS protection. All Google calls through this function share an authoritative database budget, even after a restart or across replicas. Calls made outside this function are not counted by the local 900-attempt safety buffer; Google's project limit still applies.

Book/movie searches share the app usage allowance. Existing shelf reads, edits, ratings and reviews do not use these catalog limits. A rejected request returns HTTP 429 plus Retry-After and a Japanese message. Configured clients never bypass the proxy by contacting external providers directly. Invalid input, including invalid ISBN and unsupported pages, is rejected before provider reservations. Pagination stops at page 20 rather than repeatedly requesting the same page.

## Cache Policy

- Successful permitted provider responses are shared across instances and redeploys. Concurrent identical lookups share one in-process fetch; database leases prevent simultaneous duplicate acquisitions across instances. Pending instances can use other providers instead of issuing another upstream request.
- Google caching follows its actual response headers. `private`, `no-store`, `no-cache`, absent permission, or max-age=0 means no shared persistence. Current live Google responses have a zero shared lifetime. Do not claim that repeated Google queries now avoid its quota.
- Other providers use their declared lifetime when present, otherwise a six-hour default; all shared lifetimes are capped at 24 hours. Empty array responses are capped at five minutes. HTTP errors and HTTP-200 error documents are not cached as successes. No expired/stale data is served.
- The cache retains at most 250 completed entries, with serialized payloads bounded below the SQL size limit. Expired entries are cleaned during cache completion; leases expire after 20 seconds. Oversized successful responses are returned but not persisted.
- Browser query/discovery caches also obey the returned lifetime, including zero. No cache permanently turns API metadata into a local catalog database. Search text can still appear in the public upstream metadata itself; credentials are excluded from cache identity.
- A real Google daily-quota error activates a shared cooldown until the next Pacific calendar date. Other Google quota errors pause attempts for a minute. Budget denial does not issue another Google request and the existing provider fallback/warnings remain active.

## Deployment

Schema: `readtrace-catalog-schema.sql`. The initial migration is applied to project `jjoqjdfldryeqblpobhh`; follow-up gate/preflight definitions were applied without touching shelf rows. Verification transaction: `readtrace-catalog-check.sql` (rolls back).

Run `npm run package:books-function`. Deploy `index.ts`, generated `books.mjs`, `catalog-guard.mjs`, `catalog-handler.mjs`, and `deno.json`; explicitly select `deno.json` as import map. The provider still uses `GOOGLE_BOOKS_API_KEY` from Edge secrets. No credential value belongs in this document or deployment payloads.

## Quota Increase Research, 2026-11-07

The dedicated Cloud project still shows 1,000 Queries per day. The Google Console's edit drawer directs increases above 1,000 to `https://support.google.com/books/contact/api_quota_request`. In Chrome that link redirected to the generic Google Search Help page, not a submission form. No increase request was submitted or approved. No reliable Books-specific primary source guaranteed a free increase or established a paid price. General Cloud quota adjustments are subject to review; enabling billing is not evidence of Books quota approval. Keep the existing quota and do not enable billing or buy support without owner approval.

Sources:
- https://docs.cloud.google.com/docs/quotas/view-manage
- https://developers.google.com/terms (cached content must follow permitted cache headers)
- https://www.mediawiki.org/wiki/Manual:Maxlag_parameter (interactive requests may omit bot maxlag)

The movie regression check encountered Wikidata's HTTP-200 `maxlag` error, independently reproduced outside Supabase. Interactive movie lookups now omit that optional background-bot parameter, consistent with MediaWiki guidance; normal pacing, shared budgets and the identifying User-Agent remain intact. A subsequent live lookup returned the two real film entities, including Nolan's Interstellar.
