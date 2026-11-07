# ReadTrace Production Implementation

## Architecture and Root Causes

The original buildless HTML/ES-module application is retained. No framework migration is necessary. The old catalog screen only filtered a bundled 30-book/30-movie array; Google login was gated by `googleEnabled: false`; the dedicated Supabase project had no data tables. Google-user records were stored in browser localStorage, so they could not synchronize.

The implementation now uses GitHub Pages for the frontend, Supabase Auth for Google OAuth, Supabase Postgres/RLS for records/social data, Supabase Realtime for refresh notifications, and an Edge Function for external catalog searches. Existing demos and the legacy prototype remain separate and are not deleted.

## Search

- `readtrace-books.mjs` implements title, author and validated ISBN search, ISBN-10 to ISBN-13 canonicalization, Japanese preference, bibliographic fields, provider deduplication, pagination, caching, cancellation and errors.
- Google Books is attempted first. Open Library supplements it. NDL Search supplements Japanese titles. No sample data is substituted on network failure. On 2026-11-07, enabled Books API in the dedicated project and verified the owner's Books-only key is stored as `GOOGLE_BOOKS_API_KEY` in Edge Function secrets. Live Google title/author/ISBN/English searches now succeed. The key is never included in frontend configuration or the repository.
- Seven discovery sections use live API data. The first section is not called a popularity ranking, because provider relevance is not a popularity metric. The newest section uses provider date ordering/date filters.
- Movie search uses Apple iTunes movie metadata, Japan store, with caching and approximately 20/minute pacing. When the store has no result, Wikidata film entities supplement it, excluding missions/games with similar names. Apple promotional artwork/previews are not used for new records; a title cover is shown unless the user supplies an image. Existing registered movie posters remain unchanged.
- A failed image displays a title cover; no unrelated image is substituted.
- The metadata-only Edge Function checks the app's public project key and allowed origins. Its shared cache and atomic rate budgets live in a private database schema, accessible only through service-role RPCs. A server-only default secret is used exclusively for these catalog RPCs, never to query user shelves. Supabase verifies any supplied login token before assigning a user allowance; an IP preflight limit also runs before Auth lookup. This is not an authentication boundary for private shelf data, which remains enforced separately by RLS. See `catalog-protection.md` for exact limits and cache-header rules.

## Cloud Data

`readtrace_profiles`, `readtrace_records`, `readtrace_settings`, `readtrace_follows`, `readtrace_likes`, and `readtrace_comments` have RLS enabled. Anonymous clients have no table grants. Records are readable only by the owner or authenticated users for public records. Inserts/updates/deletes verify the owner, including the new owner on updates. Likes/comments require a public completed record. Settings are owner-only. Email addresses are not copied into public profiles.

The cloud store waits for server success before updating the UI, never silently substitutes local saves for failed cloud writes, and loads the account immediately after verified login. Its Realtime subscription reloads server-authorized data, not raw event payloads. Focus/visibility changes also refresh. A shared owner/record route is fetched explicitly, so older public records outside the initial activity window can still be opened.

The initial community discovery window is 300 public records. Own records, followed owners' public records and requested public owner shelves are paginated through all results. Unrelated activity cannot displace followed records. A future large-scale feed should add user-facing pagination rather than eagerly loading the full followed history.

## Existing Data

Guest records are stored under `readtrace:guest:v1`. The existing `readtrace:books-films:v2` demo database and `readtrace:account:<auth-user-id>:v1` local Google-account databases are left intact. After real login, the account menu can import selected guest/old-account/demo shelves. Imports preserve work, rating, review, status, dates, privacy and available history, skip canonical duplicates, and never delete the source. Local demos are explicitly labelled; Google identities cannot be selected through demo login.

Guest sharing requires Google login and cloud import. Cloud sharing adds an explicit cloud marker and always requires real Auth; choosing a demo/guest user cannot reveal cloud records. Nonpublic rows are also denied through the REST API, regardless of UI state. Spoiler text is absent from unrevealed DOM/list/share previews.

## Authentication Setup and Remaining Work

Created Google Cloud project: `ReadTrace` / `readtrace-513911`. No paid APIs or billing setup was enabled by the agent.

1. Completed: the owner created the `ReadTrace Web` Web application OAuth client and entered Client ID/Secret directly in Supabase. Authorized JavaScript origin: `https://yuumaokamori015710-droid.github.io`. No secret was copied to chat or Git.
2. Completed: Google callback URI is `https://jjoqjdfldryeqblpobhh.supabase.co/auth/v1/callback`.
3. Completed: after explicit permission, enabled the stored Google provider without changing credentials. Public Auth settings now return `external.google: true`; real OAuth consent and login succeeded. Nonce/email-verification protections were not disabled.
4. Completed: Supabase Site URL and the single exact production redirect allowlist entry are `https://yuumaokamori015710-droid.github.io/readtrace-prototype/reading-prototype.html`. No wildcard or development URL was added. Development URLs require an explicit later addition.
5. Remaining branding work: Google Audience is External / Testing and homepage/privacy/terms URLs are blank. Current login requests only basic profile/email, which Google's official rules exempt from test-user-list and seven-day-expiry restrictions. In-production branding/domain publication is a separate remaining task, not falsely reported as completed. The owner chose to obtain a custom domain later; none was purchased or configured.
6. Completed Google Books setup on 2026-11-07: after explicit consent, enabled Books API in `readtrace-513911`. The owner created `ReadTrace Books` and saved it to Supabase as `GOOGLE_BOOKS_API_KEY`. Verified Books API is the only selected API, with no website restriction because requests originate from Supabase. No billing account is linked; the console showed quotas of 1,000 queries/day and 100 queries/minute/user. Redeployed the existing metadata function as version 6 to reset previous missing-key failures. Open Library/NDL remain supplements; provider warnings are still shown when one fails. These observed quotas are not a guarantee of unlimited free use.

Supabase provider page: https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/auth/providers

Supabase redirects: https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/auth/url-configuration

Supabase function secrets: https://supabase.com/dashboard/project/jjoqjdfldryeqblpobhh/functions/secrets

Google clients: https://console.cloud.google.com/auth/clients?project=readtrace-513911

The app checks actual provider settings on startup and again on sign-in; setting a pretend frontend flag is not required or treated as a fix. Google OAuth uses PKCE and top-level redirects, not a popup/third-party cookie dependency. The callback is the existing HTML file so GitHub Pages needs no server route. The original shared hash is restored after code exchange and server user verification.

The Supabase publishable key is intentionally public browser configuration, not a Google API secret or admin credential. RLS is the data authorization boundary. No service-role key, OAuth client secret or Google Books secret is shipped to GitHub Pages.

## Verification Status

- Node unit tests: 71 pass (Auth, catalog normalization/fallback, shared-cache and limit handling, cloud adapter, persistence/validation and original store behavior). Cloud adapter success cases use a substituted SDK; they are not a real Google login or cross-device test. Real Postgres catalog checks add 16 rolled-back assertions, including denial privileges, same-key leases, expiry, quota exhaustion and no global allowance consumption by individually rejected calls.
- Real Supabase transaction: 15 RLS/constraint/history assertions passed. Test auth users, profiles, records and social rows were rolled back. Table counts were rechecked as zero.
- Security advisors: no findings after the migration. Performance advisors only report unused new indexes because the tables are empty; those indexes support the FK/policy paths and are retained.
- The later Auth check reports one warning for disabled leaked-password protection. The current UI uses Google OAuth rather than application passwords; password protection/Email-provider changes were not made silently. Revisit this before offering email/password sign-in. No paid service was enabled to clear the warning.
- Live metadata endpoint: Google Books now returns real Japanese and English books. Title `こころ`, author `夏目漱石`, ISBN `9784101010137`, English title `The Hobbit`, and page 2 returned HTTP 200 with actual Google items. The ISBN result merges all three providers into one book. An intermittent NDL page-2 failure was reported without preventing Google results. Public Chrome search, additional loading, book detail and add-form handoff also passed. More checks are recorded in `verification.md`.
- GitHub Pages release `3e284be` deployed successfully (Actions run `42220511413`); public Japanese search and guest registration were exercised. Source implementation is `bd3d485` on `main`.
- Actual Google sign-in, profile/photo display, cloud create/update, account/record restore after reload, second-tab server loading, cross-tab logout, and shared-record return after another real Google login passed on the public URL. The exact test record was also read back from Postgres to confirm status/rating/privacy/dates/history. These are no longer mock-SDK-only claims.
- Two physical devices, iPhone Safari, automatic token renewal over its lifetime, and a separate real Google user's view remain unverified. Same-browser second-tab testing is not described as PC-to-phone synchronization.
- Final authenticated-UI patch `34f5976` is deployed on Pages (successful Actions run `42236699697`). The synchronization icon renders without new warnings after reload. On 2026-11-07, after explicit owner approval, deleted only the test-created cloud book through the app. Exact-row readback confirms it is gone, the shelf is empty, and the account profile is preserved. No existing user data was deleted.

## References

- https://developers.google.com/books/docs/v1/using
- https://openlibrary.org/dev/docs/api/search
- https://ndlsearch.ndl.go.jp/help/api/specifications
- https://performance-partners.apple.com/search-api
- https://www.wikidata.org/wiki/Wikidata:Data_access
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://support.google.com/cloud/answer/15549945

## Reproducible Function Deployment

Run `npm run package:books-function` before deploying `readtrace-books` with Supabase CLI or another bundler. This copies the tracked shared provider to the function's ignored `books.mjs` dependency. The frontend and function therefore use the same source without maintaining two hand-edited copies. Deploy `index.ts`, generated `books.mjs`, `catalog-guard.mjs`, `catalog-handler.mjs`, and `deno.json`; the import map must be `deno.json`. The hosted function returns public external metadata only (`verify_jwt: false`); private shelf data never passes through it. It verifies supplied login tokens only to assign a search allowance.

The final protected function is version 12. Pages `e9e49ee` deployed successfully (run `42321033850`), preserving the separately added contact feature. Public Chrome book/movie search and a 390px detail check passed; 71 Node tests and 16 rolled-back catalog SQL assertions passed. Google currently returns a zero shared-cache lifetime, so repeated Google queries still count; shared complementary-provider caching and the global 900/day safety budget are not described as unlimited Google capacity. Free Books quota expansion remains unconfirmed because the console's application link redirects to generic Help. No billing or paid change was made.
