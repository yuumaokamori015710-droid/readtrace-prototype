# ReadTrace Production Implementation

## Architecture and Root Causes

The original buildless HTML/ES-module application is retained. No framework migration is necessary. The old catalog screen only filtered a bundled 30-book/30-movie array; Google login was gated by `googleEnabled: false`; the dedicated Supabase project had no data tables. Google-user records were stored in browser localStorage, so they could not synchronize.

The implementation now uses GitHub Pages for the frontend, Supabase Auth for Google OAuth, Supabase Postgres/RLS for records/social data, Supabase Realtime for refresh notifications, and an Edge Function for external catalog searches. Existing demos and the legacy prototype remain separate and are not deleted.

## Search

- `readtrace-books.mjs` implements title, author and validated ISBN search, ISBN-10 to ISBN-13 canonicalization, Japanese preference, bibliographic fields, provider deduplication, pagination, caching, cancellation and errors.
- Google Books is attempted first. Open Library supplements it. NDL Search supplements Japanese titles. No sample data is substituted on network failure. Google Books currently returns a quota/restriction error without a valid key; the old local key is not usable. A valid Books-only key must be stored in the Edge Function secrets, never the repository.
- Seven discovery sections use live API data. The first section is not called a popularity ranking, because provider relevance is not a popularity metric. The newest section uses provider date ordering/date filters.
- Movie search uses Apple iTunes movie metadata, Japan store, with caching and approximately 20/minute pacing. When the store has no result, Wikidata film entities supplement it, excluding missions/games with similar names. Apple promotional artwork/previews are not used for new records; a title cover is shown unless the user supplies an image. Existing registered movie posters remain unchanged.
- A failed image displays a title cover; no unrelated image is substituted.
- The metadata-only Edge Function checks the app's public project key and allowed origins, has per-instance rate limiting, and never reads user tables or uses service-role credentials. This is not an authentication boundary for private data. Private data access is enforced separately by RLS.

## Cloud Data

`readtrace_profiles`, `readtrace_records`, `readtrace_settings`, `readtrace_follows`, `readtrace_likes`, and `readtrace_comments` have RLS enabled. Anonymous clients have no table grants. Records are readable only by the owner or authenticated users for public records. Inserts/updates/deletes verify the owner, including the new owner on updates. Likes/comments require a public completed record. Settings are owner-only. Email addresses are not copied into public profiles.

The cloud store waits for server success before updating the UI, never silently substitutes local saves for failed cloud writes, and loads the account immediately after verified login. Its Realtime subscription reloads server-authorized data, not raw event payloads. Focus/visibility changes also refresh. A shared owner/record route is fetched explicitly, so older public records outside the initial activity window can still be opened.

The initial community discovery window is 300 public records. Own records, followed owners' public records and requested public owner shelves are paginated through all results. Unrelated activity cannot displace followed records. A future large-scale feed should add user-facing pagination rather than eagerly loading the full followed history.

## Existing Data

Guest records are stored under `readtrace:guest:v1`. The existing `readtrace:books-films:v2` demo database and `readtrace:account:<auth-user-id>:v1` local Google-account databases are left intact. After real login, the account menu can import selected guest/old-account/demo shelves. Imports preserve work, rating, review, status, dates, privacy and available history, skip canonical duplicates, and never delete the source. Local demos are explicitly labelled; Google identities cannot be selected through demo login.

Guest sharing requires Google login and cloud import. Cloud sharing adds an explicit cloud marker and always requires real Auth; choosing a demo/guest user cannot reveal cloud records. Nonpublic rows are also denied through the REST API, regardless of UI state. Spoiler text is absent from unrevealed DOM/list/share previews.

## Owner Setup Still Required

Created Google Cloud project: `ReadTrace` / `readtrace-513911`. No paid APIs or billing setup was enabled by the agent.

1. Finish Google Auth Platform branding/contact details and choose External. The owner must accept applicable policies themselves.
2. Create a Web application OAuth client. Authorized JavaScript origin: `https://yuumaokamori015710-droid.github.io`.
3. Authorized redirect URI: `https://jjoqjdfldryeqblpobhh.supabase.co/auth/v1/callback`.
4. Enter that Client ID/Secret in Supabase Auth's Google provider and enable it. Keep nonce/email-verification protections enabled. The owner enters/seals credentials in the management UI; never paste secrets into chat or Git.
5. Supabase Site URL and exact production redirect allowlist entry: `https://yuumaokamori015710-droid.github.io/readtrace-prototype/reading-prototype.html`. Optional development entries are the exact same HTML path on `http://127.0.0.1:8011` and `http://localhost:8011`. Do not add a global wildcard.
6. For Google Books, enable the Books API in the dedicated Cloud project, create a key restricted to that API, and set `GOOGLE_BOOKS_API_KEY` in the Supabase Edge Function secrets. Do not set it in frontend code. The old local `.env` does not configure the public Edge Function.

Supabase provider page: https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/auth/providers

Supabase redirects: https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/auth/url-configuration

Supabase function secrets: https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/functions/secrets

Google clients: https://console.cloud.google.com/auth/clients?project=readtrace-513911

The app checks actual provider settings on startup and again on sign-in; setting a pretend frontend flag is not required or treated as a fix. Google OAuth uses PKCE and top-level redirects, not a popup/third-party cookie dependency. The callback is the existing HTML file so GitHub Pages needs no server route. The original shared hash is restored after code exchange and server user verification.

The Supabase publishable key is intentionally public browser configuration, not a Google API secret or admin credential. RLS is the data authorization boundary. No service-role key, OAuth client secret or Google Books secret is shipped to GitHub Pages.

## Verification Status

- Node unit tests: 52 pass (Auth, catalog normalization/fallback, cloud adapter, persistence/validation and original store behavior). Cloud adapter success cases use a substituted SDK; they are not a real Google login or cross-device test.
- Real Supabase transaction: 15 RLS/constraint/history assertions passed. Test auth users, profiles, records and social rows were rolled back. Table counts were rechecked as zero.
- Security advisors: no findings after the migration. Performance advisors only report unused new indexes because the tables are empty; those indexes support the FK/policy paths and are retained.
- Live metadata endpoint: Japanese queries return real Open Library/NDL books, with the Google restriction reported rather than hidden. More browser/deployment checks are recorded in `verification.md`.
- GitHub Pages release `3e284be` deployed successfully (Actions run `42220511413`); public Japanese search and guest registration were exercised. Source implementation is `bd3d485` on `main`.
- Actual Google sign-in, real account restore, two-device synchronization and iPhone Safari OAuth must still be verified after owner configuration. They are not reported as completed.

## References

- https://developers.google.com/books/docs/v1/using
- https://openlibrary.org/dev/docs/api/search
- https://ndlsearch.ndl.go.jp/help/api/specifications
- https://performance-partners.apple.com/search-api
- https://www.wikidata.org/wiki/Wikidata:Data_access
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Reproducible Function Deployment

Run `npm run package:books-function` before deploying `readtrace-books` with Supabase CLI or another bundler. This copies the tracked shared provider to the function's ignored `books.mjs` dependency. The frontend and function therefore use the same source without maintaining two hand-edited copies. Deploy `index.ts`, generated `books.mjs`, and `deno.json`; the import map must be `deno.json`. The hosted function is public external metadata only (`verify_jwt: false`); private data never passes through it.
