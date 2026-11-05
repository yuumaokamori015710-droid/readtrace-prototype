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
