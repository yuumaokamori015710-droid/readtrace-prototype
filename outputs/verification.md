# ReadTrace Mock Verification

Verified on 2026-11-05. This report applies to the local mock, not the legacy Supabase/API prototype.

## Automated

Run `npm test` from the repository root. Fourteen Node tests cover the 60-item catalog, 0.5-step ratings, completion validation, optional reviews/dates/images, ownership, private-record filtering, logged-out filtering, duplicates, follow/like toggles, comments and deletion, registration, local persistence, and corrupt-JSON recovery.

## Browser Checks

The following flows were exercised in the in-app browser:

- Demo login opens the user's own shelf. New registration rejects an empty name and creates an empty shelf.
- Book search for `舟を編む` returns one selectable result. Completion without a rating shows an error. A 4.5-star record with no review or completion date saves successfully.
- The saved private book persists after reload, has no record-share action, and displays an unavailable message when a different demo user opens its URL.
- Movie search for `ラ・ラ・ランド` adds a wanted movie. Editing to completed with a 0.5-star rating and a spoiler review saves successfully.
- A nonexistent movie query carries its full title into manual entry. It saves with no director, image, or rating.
- Spoiler text is absent from another user's hidden record detail, feed preview and share preview. The reveal button displays the review and comments.
- Like and comment changes survive reload. Unlike and deleting one's own comment work. Delete confirmation can be cancelled; record deletion removes the record.
- Following a user adds their public completed records to the feed. Unfollowing works. Private movie records are absent from the public profile.
- Record and movie-shelf URLs copy successfully with a toast. A copied movie completion list displays three public records. Logged-out access shows the demo login and returns to that exact list after login.
- Shelf status filtering, sorting selection and no-result search state work.
- Responsive shelf and movie editor inspected at 390px; no horizontal overflow. Additional 320px checks identified a header overflow, fixed with an icon-only add button at the smallest breakpoint. A repeat DOM measurement confirmed equal document/content widths of 305px after the scrollbar, with no horizontal overflow. At 1440px, the document/content widths were both 1425px. Screenshots are saved in `outputs/qa/`.
- A copied public book wishlist contains two records and excludes the owner's private `独学大全` record. Shelf-sharing tabs switch between both media types.
- The followed-user feed includes ten public records across all states, with social controls on only the six completed records. Private record text and unrevealed spoiler text are absent.
- Keyboard arrow navigation switches shelf tabs; Escape closes the add dialog. Changing the monthly goal survives reload. No JavaScript runtime errors appeared in the final browser check (remote image-loading errors were excluded).

Test-only records and comments were deleted through the UI. One additional empty account, `新しい読者（デモ）`, remains available in the testing browser to demonstrate empty shelves.

## Scope

The access rules are client-side simulation. All users and records exist in the browser's localStorage, not a secure server. Sharing opens a route and requires a demo session, but does not synchronize edited records across devices or origins. Image failures use a built-in fallback. No real authentication, paid APIs, cross-device synchronization or production security audit was performed.

## Google Auth Integration Update (2026-11-05)

The preceding checks describe the original mock. Google OAuth integration has now been added, but is not enabled for users yet.

- Created a dedicated Tokyo-region `readtrace` Supabase project, after the user's organization choice and a USD 0/month quote. No existing app project was modified.
- Verified the new project's public Auth settings report `external.google: false`. Google credentials and redirect allowlist still need owner setup; `googleEnabled: false` prevents an invalid outbound sign-in.
- `npm test`: 28 tests pass, including 14 auth tests using a substituted SDK. These cover PKCE configuration, a single code exchange, server user verification, safe internal return paths, query/fragment error cleanup, expired-code rejection, no acceptance of implicit tokens, logout, and isolated per-Google-user local shelves.
- Real browser: the local SDK loads without console errors. The Google button while setup is incomplete shows the preparation notice without leaving the app. Demo login/logout and switching still work.
- Opened a shared completion list while logged out, selected a different demo user, and verified the exact shared hash route and public list are preserved. This is a demo-flow check, not a successful Google OAuth check.
- Inspected the new login screen at 390px; no horizontal overflow. Inspected the header and new icons on desktop and the shelf at 320px. Fixed a narrow movie-tab label wrap; repeat measurement showed 42px tabs without internal overflow. Temporary viewport settings were reset.
- Actual Google consent, successful Google login, real token refresh, cross-tab real-session logout, and real-account reload persistence have NOT been verified. They require completion of Google/Supabase provider settings and an owner login.
- Shelves and social functions remain a browser-storage mock. Real Auth does not yet provide cloud record storage, RLS, cross-device synchronization, or sharing between real Google accounts. See `readtrace-auth-setup.md`.

## Official Google Button Update

- Replaced the generic sign-in arrow with Google's unmodified standard-color G logo from the official Google Identity branding page. Both the login page and demo account menu use the same Japanese `Google でログイン` button.
- Button structure and light-theme states derive from Google's official HTML configurator. Google Sans for the Latin label is bundled with its OFL license; Japanese glyphs use the system UI font. This is an HTML button connected to Supabase OAuth, not a GIS SDK-rendered button.
- Local browser checks at desktop 1280px and mobile 320px: white background, `#747775` border, loaded 200px source logo displayed at 20x20px, 44px touch target, and no document or label overflow. The viewport override was reset.
- The account-menu Google button reaches the existing sign-in handler. While provider setup remains incomplete, it shows the preparation notice rather than navigating to a broken OAuth endpoint.
- All 28 existing tests still pass. Authentication configuration, Google enablement and real-login verification are unchanged and remain pending owner setup.

## Live Catalog and Cloud Storage Update (2026-11-06)

The earlier mock-only statements describe the previous release, not the newly deployed schema/adapter. Google OAuth itself remains incomplete pending owner credentials.

- `npm test`: 52 passing Node tests. New coverage includes ISBN normalization/deduplication, provider failures, serial API requests, real-metadata movie fallback, untrusted public metadata, remote-deletion conflicts, followed activity beyond the discovery window, and cloud-share callback restoration. Auth/cloud success tests substitute the SDK and are not production login/sync evidence.
- Applied the dedicated Supabase schema with six RLS-enabled tables. A real SQL transaction passed 15 access-control/constraint/history assertions under different authenticated users and the anonymous role, then rolled back every fixture. Rechecked all six tables: zero rows. Security advisor: no findings. Performance advisor: unused new indexes only.
- Deployed the metadata-only `readtrace-books` Edge Function, version 4. Verified author search `夏目漱石` page 1 returns 18 real results, page 2 returns 36 combined results; ISBN `9784101010137` returns `こころ`. Google Books quota/restriction warnings remain visible. Open Library/NDL failures are reported, not replaced with samples.
- Local browser: searched `こころ`, inspected actual metadata, added it, rejected completion without rating, saved 4.5 with no review, start/completion dates and private visibility, reloaded successfully, then changed it to reading/unrated. Movie search `インターステラー` returns two Wikidata film entities; selected Nolan's film and saved a 0.5 completed record with spoiler review.
- A unique nonexistent query displayed zero results and carried its title into manual entry. Added without optional author/image/rating, opened the record, inspected delete confirmation, and deleted that test record through the UI.
- Existing demo regression checks: spoiler review/comments absent until reveal, reveal works, like/unlike, comment post/delete, follow/unfollow, copied URL plus completion notification, and logged-out shared record returning to the same target after another demo login. These are explicitly local demo tests, not cloud social E2E.
- Discovery sections populate with real external metadata and title-cover fallbacks. Some NDL cover requests return HTTP 403 in the testing environment; no image success is claimed for those. Title fallback layout remains usable.
- Browser responsive checks: desktop 1280px document 1265px, mobile 390px document 375px, mobile 320px document 305px (scrollbar accounted for), without horizontal overflow. Inspected the 320px grid and the 390px existing orbit view. Mobile filter layout was tightened after inspection. Temporary viewport overrides were reset. This is desktop Chromium responsive testing, not physical iPhone Safari testing.
- A review found and fixed unescaped cloud metadata, stale-record resurrection, account-switch async UI effects, old local-share routing, concurrent Open Library requests, followed-feed truncation, and lost discovery newest ordering. Added a reproducible function packaging command.
- No existing guest/demo/account storage was deleted or uploaded automatically. Local browser tests created one private book and one completed movie in the newly empty guest store; test-only comment/manual-entry fixtures were removed.
- Created Google Cloud project `ReadTrace` / `readtrace-513911`, without enabling billing/paid APIs. Branding/contact policies, OAuth client credentials, Supabase Google provider and exact redirects require owner completion. Actual Google consent/login, real-account restore, two-device synchronization and iPhone Safari OAuth have NOT been verified. A valid Google Books key is also still required for the preferred provider.

### Deployment

- Source commit: `bd3d485` pushed to `main`. Static frontend commit: `3e284be` pushed to `gh-pages`. GitHub Actions Pages run `42220511413` completed successfully.
- Public release URL: `https://yuumaokamori015710-droid.github.io/readtrace-prototype/reading-prototype.html?release=20261106-catalog`.
- Public browser: an empty guest shelf opens, Japanese title search `吾輩は猫である` returns 26 real Open Library/NDL results, bibliographic detail opens, and adding a reading/unrated book works. Captured search proof in ignored `outputs/qa/public-live-search.png`; it includes one loaded actual cover and graceful fallbacks for others.
- Rechecked production Auth settings after deployment: `external.google` remains false. Deploy success is not Google authentication completion.
