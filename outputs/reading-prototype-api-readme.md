# ReadTrace Prototype: Book APIs

The GitHub Pages frontend calls a Supabase Edge Function for live book searches.
Google Books is the first provider, with Open Library and NDL Search as supplements.
No Google credential is included in the static site.

```text
GitHub Pages -> readtrace-books Edge Function -> Google Books API
                                            -> Open Library search API
                                            -> NDL Search OpenSearch API
```

## APIs

- Google Books: title, author and ISBN search; covers and bibliographic metadata.
- Open Library: complementary international/English metadata, ISBNs and covers.
- NDL Search: supplementary Japanese title and ISBN search.
- Bundled sample catalogs are limited to the separate, explicitly labelled demo mode.
  Live searches never substitute sample results when providers fail.

## Search Flow

1. Validate the query and canonicalize valid ISBN-10/ISBN-13 values.
2. Search Google Books first and supplement with Open Library.
3. Add NDL Search results for Japanese queries or ISBN searches.
4. Deduplicate by canonical ISBN/provider identity and prefer Japanese metadata.
5. Return paginated results with source credits and explicit provider warnings.
6. Keep manual entry available for missing books and network failures.

## Notes

- Enable Books API in the dedicated Google Cloud project `readtrace-513911`.
- Create a Books-API-only key and store it as `GOOGLE_BOOKS_API_KEY` in the
  Supabase project `jjoqjdfldryeqblpobhh` Edge Function secrets. Never put it in
  `readtrace-config.mjs`, HTML, a browser query string or Git.
- Requests originate from Supabase, not GitHub Pages. Website/referrer restrictions
  are therefore not appropriate for this server-side key. Restrict its API scope
  to Books API; do not enable unrelated APIs or link billing as part of setup.
- The Google Cloud console showed no linked billing account on 2026-11-07, with
  Books quotas of 1,000 queries/day and 100 queries/minute/user. These are observed
  project limits, not a promise of unlimited free service.
- Debouncing, caching, provider timeouts and rate-limit backoff reduce API traffic.
  The public metadata endpoint has best-effort per-instance limits, not a durable
  global abuse-control boundary.
- NDL Search requires visible credit and has usage guidance for continuous access.
- Real Google login uses Supabase Auth; cloud shelves use `readtrace_records` with
  row-level security. Legacy guest/demo stores remain separate and importable.
- See `production-status.md` and `verification.md` for deployment and actual checks.
