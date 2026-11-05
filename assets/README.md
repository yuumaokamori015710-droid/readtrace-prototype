# Demo Assets

- `google-g-logo.png`: unmodified standard-color G logo downloaded from https://developers.google.com/static/identity/images/g-logo.png. Used only in Google sign-in buttons, following https://developers.google.com/identity/branding-guidelines. Google brand artwork is not covered by the application's own license.
- `google-sans-signin.ttf`: Google Fonts' 500-weight Google Sans subset for the text `Google`, fetched through https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap&text=Google. Original license: `GOOGLE-SANS-OFL.txt`. Japanese glyphs fall back to the system UI font.
- Google sign-in button markup/styles derive from the official HTML configurator on the branding page (light rectangle, Japanese label, standard-color logo). Integration keeps the existing Supabase OAuth handler; it is not a Google Identity Services SDK-rendered button.

- `readtrace-mark.png`: approved "pages and play" ReadTrace mark, generated for this project; transparent charcoal symbol shared by book/movie themes.
- `supabase-2.119.0.js`: Supabase JavaScript SDK 2.119.0, from the official npm package via jsDelivr; MIT license in `SUPABASE-LICENSE`. Loaded only when Auth is configured.

- `lucide.min.js`: Lucide 0.468.0, distributed by https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js (ISC license; original license header retained).
- `three.module.min.js`: Three.js 0.170.0, distributed by https://unpkg.com/three@0.170.0/build/three.module.min.js (MIT; `three-LICENSE.txt`). Used for the mobile interactive cover shelf.
- `b2.jpg`, `b3.jpg`, `b5.jpg`, `b16.jpg`: sample book covers retrieved from Open Library, using the ISBN URLs in `readtrace-data.mjs`.
- `m3.jpg`, `m4.jpg`, `m6.jpg`: sample movie posters retrieved from TMDB, using the image paths in `readtrace-data.mjs`.

Cover and poster artwork belongs to the respective rights holders. These small images are included for identifying works in this local, noncommercial demonstration. Confirm artwork usage rights and attribution requirements before production distribution. The app uses a typographic fallback if an image cannot load. Other sample works may request remote images; no book or movie search API is called by the new mock.
