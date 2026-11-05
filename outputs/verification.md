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
