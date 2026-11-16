# 381s-galleries — client galleries for 381 Studios (Pixieset alternative)

> Live at **https://session.381studios.ar/<slug>** · Repo: `PAumedes/381s-galleries`
> This file is the single source of truth for the build. Every contributor reads the sections it needs before starting a task.
> Work happens **one task at a time**: touch only the files listed for that task and stop when the acceptance criteria pass.

---

## 1. Goal

Deliver photos to clients through branded online galleries, at $0/month infrastructure cost (besides Google Drive storage).

- **All images** (every size) are exported by **Capture One** into a folder synced by **Google Drive for desktop**. No upload script, no image processing anywhere else.
- The app **only reads** Drive. It discovers galleries and photos by scanning a Drive folder.
- **App + API** run on **Cloudflare Workers**, data in **Cloudflare D1**, **R2** used only as a cache for preview images.
- No home server, no always-on machine.

## 2. Fixed technical decisions (do not change without asking)

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript (strict) | |
| Web framework | **React Router (framework mode, v8 at scaffold time)** on Cloudflare Workers, using Cloudflare's official React Router template (`@cloudflare/vite-plugin`) | First-class Workers support; loaders/actions give SSR + API in one project; largest React ecosystem |
| Styling | **Tailwind CSS v4** | Predictable, no separate CSS architecture to maintain |
| DB | Cloudflare D1 + **Drizzle ORM** (`drizzle-orm/d1`), migrations with `drizzle-kit` → `wrangler d1 migrations` | Typed queries, fewer SQL bugs |
| Image source | Google Drive API v3, **read-only** (`https://www.googleapis.com/auth/drive.readonly`) | Files are created by Drive for desktop, not by the app, so `drive.file` can't see them |
| Preview cache | R2 bucket `381s-galleries-cache`, key `<photoId>/<variant>`; filled lazily on first request | Fast repeat views, fewer Drive calls |
| Google auth | OAuth **Web application** client. Admin clicks "Connect Google" once; the Worker runs the OAuth flow and stores the refresh token (encrypted with `TOKEN_KEY`) in D1. Consent screen **In production** (unverified is fine for personal use; you'll see a warning screen once) | No local scripts |
| Admin auth | **Cloudflare Access** on `/admin*` and `/api/admin*`. App verifies the `Cf-Access-Jwt-Assertion` JWT (RS256 vs team JWKS, `aud` = `ACCESS_AUD`, `iss`, `exp`/`nbf`); its `email` claim must equal `ADMIN_EMAIL` (the header alone is never trusted). Needs `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` | No login code |
| Client auth | Gallery slug + optional PIN → HMAC-signed cookie (Web Crypto, `SESSION_SECRET`), scoped per gallery | |
| Download links | Short-lived HMAC tokens `/dl/<token>`, 10 min TTL, `DOWNLOAD_SECRET` | |
| Sync | Cloudflare **Cron Trigger** every 15 min + "Sync now" button in admin | |
| Bulk download | Browser-side zip with `client-zip` | No server zipping |
| Image processing | **None.** Never resize, re-encode or watermark in code | Capture One does all of it |
| URLs | Public: `https://session.381studios.ar/<slug>`. Admin: `/admin`. Reserved slugs (rejected by sync, suffixed with `-2`): `admin, api, img, dl, assets, brand, favicon.ico, robots.txt, manifest.webmanifest` | |
| i18n | **Spanish (default) + English**. Strings in `app/i18n/{es,en}.ts` with a typed key set; language from `?lang=` → cookie → `Accept-Language` → `es`. Small ES/EN toggle in the footer. Admin UI in Spanish only | |
| Branding | Studio name "381 Studios", black/white logos (see §5.8), Montserrat | |
| Max image size | **2048px is the largest file delivered.** Web sharing only, no prints, no full-size originals | |
| Dev mode | `DRIVE_MODE=mock` (§5.9): fake galleries, images from picsum.photos. Default in `.dev.vars.example` | Build and test without Google |
| Package manager | pnpm (single package, no monorepo) | |
| Timestamps | ISO 8601 UTC strings `YYYY-MM-DDTHH:MM:SSZ` everywhere (`nowIso()`) | |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` | |
| Lint/format | ESLint + Prettier defaults | |

## 3. Drive folder convention (the photographer's side)

```
My Drive/
└─ 381studios/                        ← root folder, ID stored in settings
   └─ name-of-the-album/              ← one folder = one gallery (folder name → slug; title editable in admin)
      ├─ high-res/                    ← 2048px long edge — required. "High-res" download + lightbox on large screens
      ├─ web/                         ← 1200px long edge — "Web" download + lightbox on phones
      ├─ ig/                          ← 1080px long edge — "Instagram" download
      ├─ thumb/                       ← 600px long edge — grid
      └─ preview-wm/                  ← optional, 2048px with C1 watermark — replaces high-res/web while *viewing* only
```

- All recipes: JPEG, sRGB, made by Capture One. The app never resizes or re-encodes.
- **Sets:** optional subfolders with the same name inside each recipe folder (`high-res/Ceremonia/`, `web/Ceremonia/`…). Files at the recipe root go to set "Highlights".
- **Matching rule:** files match across recipe folders by **set + base filename without extension**. `high-res` is required. Fallbacks: `web` → `high-res`, `thumb` → `web` → `high-res`. `ig` is optional; if missing, the Instagram download option is hidden for that photo. `preview-wm` optional.
- Mismatches (e.g. a file in `thumb` with no `high-res`) are listed in the admin gallery page, not silently dropped.
- Capture One: all recipes enabled in one export, output `…/381studios/[Session Name]/<recipe folder>`. One click produces everything.

## 4. Data model (Drizzle schema in `app/db/schema.ts`)

```ts
settings      (key PK, value)                           // drive_root_id, google_refresh_token (encrypted), access_token cache, branding
galleries     (id PK, drive_folder_id UNIQUE, slug UNIQUE, title, client_name?, event_date?,
               pin_hash?, expires_at?, status: 'draft'|'published'|'archived' default 'draft',
               cover_photo_id?, allow_highres bool=1, allow_web bool=1, allow_ig bool=1, allow_bulk bool=1,
               require_email bool=1, use_watermark_preview bool (auto true if preview-wm exists),
               drive_modified_at?, last_synced_at?, sync_issues_json?, created_at)
photos        (id PK, gallery_id FK cascade, set_name default 'Highlights', base_name,
               drive_highres_id, drive_web_id?, drive_ig_id?, drive_thumb_id?, drive_wm_id?,
               highres_bytes?, width?, height?, taken_at?, sort int,   // width/height of high-res
               UNIQUE(gallery_id, id), UNIQUE(gallery_id, set_name, base_name))
visitors      (id PK, gallery_id FK, email, name?, first_seen,
               UNIQUE(gallery_id, id), UNIQUE(gallery_id, email COLLATE NOCASE))
favorites     (gallery_id, visitor_id, photo_id, list_name default 'Favoritos', comment?, created_at,
               PK(visitor_id, photo_id, list_name),
               FK(gallery_id, visitor_id) -> visitors(gallery_id, id) cascade,
               FK(gallery_id, photo_id) -> photos(gallery_id, id) cascade)   // same-gallery guaranteed by DB
downloads     (id PK, gallery_id, photo_id?, visitor_id?, variant: 'highres'|'web'|'ig',
               kind: 'single'|'bulk', country?, ua?, created_at)
gallery_views (gallery_id, visitor_id?, country?, created_at)
pin_attempts  (ip_hash, gallery_id, count, window_start)  // rate limit
```

Width/height/taken_at come from Drive's `imageMediaMetadata` (no EXIF parsing in code). Sort = `taken_at`, then filename; admin can reorder.

## 5. Core flows

### 5.1 Sync (cron + button) — `app/lib/server/sync.ts`
1. List child folders of the root → upsert a `galleries` row per folder (new ones start as **draft**, slug = slugified folder name, title = folder name).
2. Change detection: Drive folder `modifiedTime` does NOT reflect changes deep inside it, so use the **Changes API**: keep a `drive_changes_token` in `settings`; if `listChanges(token)` reports nothing changed (and it's not a forced "Sync now"), stop. Otherwise rescan every non-archived gallery: list recipe folders and their set subfolders (paginate, request only `id,name,mimeType,size,modifiedTime,imageMediaMetadata(width,height,time)`). Store the new token only after a successful run.
3. Build photo records with the matching rule (§3). Upsert; delete rows whose high-res file disappeared and delete their R2 cache keys.
4. Store mismatches in `sync_issues_json`; set `use_watermark_preview` if `preview-wm` exists.
5. Stay within Worker limits: process galleries in batches, continue next cron run if needed (`last_synced_at` cursor).

### 5.2 Client views gallery
`/:slug` → PIN form if needed → cookie. Draft/expired/archived → "gallery unavailable" page. Justified grid of thumbs (using width/height), sets as tabs, lightbox showing `web` (or `preview-wm` when watermark is on), keyboard + swipe, preload next. Log one `gallery_views` row per session.

### 5.3 Images route — `/img/:photoId/:variant` (`thumb` | `view-sm` | `view-lg`)
Check gallery cookie for that photo's gallery → try R2 `<photoId>/<variant>` → on miss, stream from Drive (`files/<id>?alt=media`), `tee()` the body into R2 and the response. `Cache-Control: private, max-age=86400`, ETag.
- `thumb` → thumb (fallbacks per §3)
- `view-sm` → web 1200 (lightbox on phones, via `srcset`/`sizes`)
- `view-lg` → high-res 2048 (lightbox on large/retina screens)
- When watermark is on, both `view-*` serve `preview-wm`.

### 5.4 Email gate
If `require_email`, the first download or favorite opens an email (+ optional name) form → upsert `visitors` (normalize email with trim + lowercase before insert/lookup; the DB unique index is also NOCASE) → visitor id in the cookie.

### 5.5 Download
1. `POST /api/:slug/download-tokens {photoIds[], variant}` (max 50) → check session + gallery flags → returns `/dl/<token>` URLs.
2. `GET /dl/:token` → verify HMAC + expiry → insert `downloads` row → stream from Drive with `Content-Disposition: attachment; filename="<base_name>[-web|-ig].jpg"` and `Content-Length`. Variants: `highres` (2048), `web` (1200), `ig` (1080). Downloads always serve the **clean** files, never `preview-wm`. No buffering.
3. Access token: `app/lib/server/drive.ts#getAccessToken()` refreshes from the stored refresh token, caches in `settings` until 5 min before expiry; on 401 refresh once and retry.

### 5.6 Download all / set
Browser: request tokens in batches of 50 → fetch each `/dl/<token>` → `client-zip` → `showSaveFilePicker` when available, else Blob fallback with a warning above ~2 GB. Log one `kind=bulk` row plus per-photo rows (the `/dl` hits do that).

### 5.7 Admin (behind Cloudflare Access)
- **Setup page:** Connect Google (OAuth), pick root folder (paste link or ID), branding (studio name, logo URL, accent color).
- **Galleries list:** status, photo count, views, downloads, expiry, sync issues badge, "Sync now".
- **Gallery edit:** title, slug, client, date, PIN set/clear, expiry, status (publish button), flags, cover picker, reorder (drag), sync issues list.
- **Share panel:** link + copy, **QR code** (SVG/PNG via `qrcode`, generated in browser), printable A6 card (QR, title, studio logo).
- **Activity:** views + downloads (who, photo, variant, when, country), CSV export.
- **Favorites:** per visitor/list, **"Copy for Capture One"** → base names joined by spaces (paste into C1 search/filter) + `.txt` download.

The app never writes or deletes anything in Drive. To remove photos, delete them in Drive; the next sync picks it up.

### 5.8 Design direction (client-facing UI)
Simple, elegant, minimal, **Pixieset-inspired**: the photos are the interface.
- **Cover:** full-viewport hero with the cover photo, album title in Montserrat (light weight, wide tracking, uppercase), date + studio name small and spaced, a subtle "View gallery" scroll cue. Optional cover layouts later (centered / left / split).
- **Typography:** **Montserrat only** (self-hosted via `@fontsource-variable/montserrat`). Titles: weight 300, uppercase, letter-spacing ~0.2em. UI: weight 400/500, small sizes, uppercase micro-labels with generous tracking.
- **Logos:** black-and-white only. `public/brand/logo-black.svg` on light backgrounds, `public/brand/logo-white.svg` on dark ones and over the cover photo. The palette stays monochrome (black, white, warm greys); no accent colour.
- **Colour:** near-white background (#FAFAF8-ish), near-black text, one muted accent from branding. Dark lightbox. Optional dark gallery theme per album.
- **Grid:** justified rows (Flickr-style) with thin gutters (4–8px), lazy-loaded, fade-in on load, no borders/shadows/rounded cards.
- **Top bar:** appears after the cover, sticky, translucent with blur: studio logo left, set names centered as text tabs, icon buttons right (favorites, download all, share). Hides on scroll down, shows on scroll up.
- **Hover/tap on a photo:** discreet heart + download icons in a corner, nothing else.
- **Lightbox:** black, image centered with breathing room, thin icon controls (close, prev/next, heart, download), filename-free, swipe on mobile, counter "12 / 340" in small caps.
- **Download sheet:** clean modal listing only the enabled sizes with plain names: "High resolution · 2048 px", "Web · 1200 px", "Instagram · 1080 px".
- **Motion:** short, soft transitions (150–250 ms ease-out). No bounces, no spinners where a fade will do.
- **Mobile first:** everything usable one-handed; icon hit areas ≥44px.
- **Admin UI:** same visual language, but functional and dense: simple tables, side panel forms.
- No stock UI kit look (no default shadcn cards). Tailwind with a small set of custom tokens in `app/app.css`.

### 5.9 Mock Drive (development)
`app/lib/server/drive-mock.ts` implements the same interface as `drive.ts` and is selected when `DRIVE_MODE=mock`.
- Fixtures in `app/lib/server/fixtures.ts`: 3 galleries (e.g. a wedding with sets "Ceremonia"/"Fiesta" ~120 photos, a portrait session ~30 photos with `preview-wm`, a gallery with sync mismatches), mixed landscape/portrait aspect ratios, deterministic ids.
- Images: In mock mode the /img and /dl routes (not the Drive mock) respond with a 302 to `mockImageUrl(photoId, variant)`; i.e. a **302 redirect** to `https://picsum.photos/seed/<photoId>/<w>/<h>` using the right size for each variant (thumb 600, web 1200, ig 1080, high-res 2048 long edge). The browser fetches them; the Worker never does (the dev sandbox can't reach picsum anyway). No R2 caching in mock mode.
- Download logging, favorites, PIN etc. all work normally against local D1.
- `pnpm seed` runs a mock sync so the admin and galleries are populated.

## 6. Security rules
- Never expose Drive file IDs, R2 keys or tokens to the client.
- Every client route checks the gallery cookie **and** that the photo belongs to that gallery **and** gallery is published + not expired.
- PIN: PBKDF2-SHA256 (Web Crypto), 100k iterations, random salt; max 5 attempts / 10 min per IP+gallery.
- Constant-time comparison for HMACs.
- Refresh token stored AES-GCM encrypted (`TOKEN_KEY`).
- Secrets only via `wrangler secret put` / `.dev.vars` (gitignored).

## 7. Task breakdown

Status: `[ ]` todo · `[~]` in progress · `[x]` done. Each task updates only its own task's checkbox.
Tasks marked **∥** within a phase touch disjoint files and can run in parallel.

### Phase 0 — Foundation (sequential)
- [x] **T0.1 Scaffold.** Cloudflare React Router template, Tailwind v4, Drizzle, Vitest (workers pool), ESLint/Prettier, `wrangler.jsonc` with `DB`, `CACHE` (R2), cron `*/15 * * * *`, `.dev.vars.example`. *Accept:* `pnpm dev` serves hello page; `pnpm test`, `pnpm build` pass.
- [x] **T0.2 Schema.** `app/db/schema.ts` per §4, first migration, `app/db/index.ts` helper. *Accept:* migration applies locally; test inserts/reads a gallery.
- [x] **T0.3 Crypto + auth utils.** `app/lib/server/crypto.ts` (HMAC, PBKDF2, AES-GCM, ids), `app/lib/server/auth.ts` (gallery cookie, admin guard). *Accept:* unit tests incl. tampered/expired tokens and wrong admin email.

### Phase 1 — Google + sync
All Phase 1 code implements/uses the contract in `app/lib/server/drive-types.ts`.
- [x] **T1.1 ∥ Google OAuth.** `app/lib/server/google-auth.ts` (`getAccessToken(env, {forceRefresh?})`, token cached in `settings`) + routes `/admin/google/connect` and `/admin/google/callback` (OAuth `state` CSRF protection, scope drive.readonly, `access_type=offline`, `prompt=consent`), refresh token stored encrypted. *Accept:* tests with mocked token endpoint; cache hit/miss/expiry; bad state rejected; admin-only.
- [x] **T1.2 ∥ Drive client.** `app/lib/server/drive.ts`: `createDriveClient(getToken: (forceRefresh?: boolean) => Promise<string>, fetchImpl = fetch): DriveClient`. Paginated, minimal `fields`, excludes trashed, query values escaped, retries 429/5xx with backoff (max 3), on 401 refreshes the token once. *Accept:* mocked-fetch tests incl. pagination, escaping, 401 refresh, 404 → DriveError, streaming without buffering, Range passthrough.
- [ ] **T1.3 Sync engine** (after T1.1, T1.2, T1.4). `sync.ts` per §5.1 (takes a `DriveClient`), `getDrive(env)` factory (mock vs google), `scheduled` handler, `POST /api/admin/sync`, `pnpm seed` (mock sync into local D1). *Accept:* tests on the mock fixtures: sets, fallbacks, mismatch reporting, deletion, wm detection, reserved/duplicate slugs, idempotent re-run, changes-token skip.

- [x] **T1.4 ∥ Mock Drive + fixtures** per §5.9: `app/lib/server/drive-mock.ts` (`createMockDrive(fixtures)`: DriveClient) + `fixtures.ts` + `mockImageUrl(fileId, variant)` helper for picsum. Fixture tree mirrors §3 exactly (root `381studios` → album folders → recipe folders → optional set subfolders). Includes a mutation API for tests (add/remove/rename file → bumps changes token).

### Phase 2 — Client gallery
- [ ] **T2.1 ∥ Gallery page + PIN + status/expiry + view logging.** `app/routes/$slug*.tsx`, `PinForm`.
- [ ] **T2.2 ∥ Grid + Lightbox components.** `app/components/Grid.tsx`, `Lightbox.tsx` (justified layout, keyboard, swipe, preload).
- [ ] **T2.3 ∥ Images route** per §5.3 with R2 read-through cache. *Accept (carried from T1.4 review):* in mock mode the 302 Location seed equals the DB photo id and never contains any drive_*_id.
- [ ] **T2.4 Email gate + favorites** (after T2.1). `EmailGate.tsx`, visitor + favorites API, heart button in grid and lightbox.

### Phase 3 — Downloads
- [ ] **T3.1 Token endpoint + `/dl/:token`** per §5.5. *Accept:* integration test streams a mocked Drive body without buffering; expired → 410; no download variant ever returns the preview-wm file.
- [ ] **T3.2 Download UI.** `DownloadMenu.tsx` (High-res / Web / Instagram per flags), download all / set with `client-zip`, progress.

### Phase 4 — Admin UI
- [ ] **T4.1 ∥ Setup page** (connect Google, root folder, branding).
- [ ] **T4.2 ∥ Galleries list + gallery edit** (incl. reorder, cover, sync issues, publish).
- [ ] **T4.3 ∥ Share panel + QR + print card.**
- [ ] **T4.4 ∥ Activity + favorites views, CSV, "Copy for Capture One".**

### Phase 5 — Polish & deploy
- [ ] **T5.1 Branding/theme**, dark/light, OG image (cover via `/img`), full i18n per §2 (es + en).
- [ ] **T5.2 PWA** manifest + "add to home screen".
- [ ] **T5.3 `DEPLOY.md`:** Cloudflare (D1, R2, secrets, Access app, custom domain), Google Cloud (Drive API, OAuth web client, redirect URI, In production), Capture One recipe setup.
- [ ] **T5.4 Final review** against §6 (security review).

### Backlog (not now)
- Email notifications (Resend / Gmail SMTP)
- Mercado Pago checkout for prints/digitals
- Video in galleries
- Wall-monitor kiosk (`/kiosk/:slug` auto slideshow)
- Face search (needs compute outside Workers)

## 8. Definition of done (every task)
1. **TDD:** tests written first and seen failing (red), then implementation (green), then refactor.
2. Acceptance criteria pass.
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
4. **Adversarial review:** the task was reviewed adversarially and either reported `No findings` or every finding has a test in `test/adversarial/` that now passes (or is skipped with a stated reason the orchestrator accepted).
5. Only the task's files changed (plus its checkbox in §7 and `test/adversarial/`).
6. One commit per task (implementation + adversary fixes), message `T<x.y>: <summary>`.

## 9. Workflow
See `.claude/WORKFLOW.md`.

## 10. (reserved)

## 11. Manual steps for the photographer
1. Cloudflare: add custom domain `session.381studios.ar` to the Worker (DNS already on Cloudflare). Worker has workers.dev and preview URLs disabled; only the custom domain serves it.
2. Google Cloud project → enable Drive API → OAuth **Web** client with redirect `https://<domain>/admin/google/callback` → consent screen **In production**.
3. Cloudflare Zero Trust → Access application for `/admin*` and `/api/admin*` allowing your email. Copy the application's **Audience (AUD) tag** (Access > Applications > your app > Overview) into `ACCESS_AUD`, and your team domain (`<team>.cloudflareaccess.com`, Zero Trust > Settings > Custom Pages) into `ACCESS_TEAM_DOMAIN`.
4. `wrangler secret put`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`, `ADMIN_EMAIL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`. Secrets must be >= 32 chars (`openssl rand -base64 32`).
5. Drive for desktop syncing `My Drive/381studios`.
6. Capture One: create the recipes from §3, all enabled, output to `…/381studios/[Session Name]/<recipe>`.
7. Admin → Setup → Connect Google → paste root folder → after a sync, publish the gallery and share the link/QR.
