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
| Branding | Studio name "381 Studios", black/white logos (see §5.8), Montserrat, monochrome palette (no accent colour) | |
| Max image size | **2048px is the largest file delivered.** Web sharing only, no prints, no full-size originals | |
| Dev mode | `DRIVE_MODE=mock` (§5.9): fake galleries, images from picsum.photos. Default in `.dev.vars.example` | Build and test without Google |
| Package manager | pnpm (single package, no monorepo) | |
| Timestamps | ISO 8601 UTC strings `YYYY-MM-DDTHH:MM:SSZ` everywhere (`nowIso(date?)` in `app/db/index.ts`). One exception: the `sync_lock` settings value is `<iso>\|<uuid>` (expiry + owner token) | |
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
settings      (key PK, value)                           // keys (constants in settings.ts): drive_root_id, google_refresh_token (encrypted), google_access_token (encrypted cache),
               //   oauth_state_used:<nonce>, drive_changes_token, sync_lock (`<iso>|<uuid>`), r2_pending_deletes, sync_last_error; branding later
galleries     (id PK, drive_folder_id UNIQUE, slug UNIQUE, title, client_name?, event_date?,
               pin_hash?, expires_at?, status: 'draft'|'published'|'archived' default 'draft',
               cover_photo_id?, allow_highres bool=1, allow_web bool=1, allow_ig bool=1, allow_bulk bool=1,
               require_email bool=1, use_watermark_preview bool (auto true if preview-wm exists),
               drive_modified_at?, last_synced_at?, sync_issues_json?,
               folder_missing_since?, archived_prev_status? ('draft'|'published'), created_at)
photos        (id PK, gallery_id FK cascade, set_name default 'Highlights', base_name,
               drive_highres_id, drive_web_id?, drive_ig_id?, drive_thumb_id?, drive_wm_id?,
               highres_bytes?, variant_versions? (JSON {highres,web,ig,thumb,wm} = each variant's Drive modifiedTime), width?, height?, taken_at?, sort int,   // width/height of high-res
               missing_since?,                                         // set while the high-res file is absent (sync grace period)
               UNIQUE(gallery_id, id), UNIQUE(gallery_id, set_name, base_name))
visitors      (id PK, gallery_id FK, email, name?, first_seen,
               UNIQUE(gallery_id, id), UNIQUE(gallery_id, email COLLATE NOCASE))
               // Anonymous visitors (favourite without email, only when require_email=0): email = `anon-<uuid>@anon.invalid`
               // (`ANON_DOMAIN`; real emails on that domain are rejected). Exclude them from stats and CSV export.
favorites     (gallery_id, visitor_id, photo_id, list_name default 'Favoritos', comment?, created_at,
               PK(visitor_id, photo_id, list_name),
               FK(gallery_id, visitor_id) -> visitors(gallery_id, id) cascade,
               FK(gallery_id, photo_id) -> photos(gallery_id, id) cascade)   // same-gallery guaranteed by DB
downloads     (id PK, gallery_id, photo_id?, visitor_id?, variant: 'highres'|'web'|'ig',
               kind: 'single'|'bulk', token_id? UNIQUE (jti of the /dl token: retries log once), country?, ua?, created_at)
gallery_views (gallery_id, visitor_id?, country?, ip_hash?, created_at)  // idx (gallery_id, ip_hash, created_at); cookieless views deduped per (gallery, ip_hash) for 30 min
rate_limits   (key PK, count, window_start)  // the ONE fixed-window limiter (`rateLimit(env, scope, key, max, windowMs)`, `app/lib/server/rate-limit.ts`);
               //   key = `<scope>:<key>`; scopes: `pin:<ip_hash>:<gallery_id>` (5/10 min; pseudo-gallery `unknown`), `visitor:<ip_hash>:<gallery_id>`,
               //   `anon:<ip_hash>:<gallery_id>`, `dl:<ip_hash>:<gallery_id>` (120 token/bulk requests per 10 min). Expired rows of a scope are pruned opportunistically.
```

Width/height/taken_at come from Drive's `imageMediaMetadata` (no EXIF parsing in code). The `DriveFile` contract (`drive-types.ts`, shared by the real client and the mock) carries `trashed` and **rotation-corrected** `width`/`height` (the real client swaps them for EXIF rotation 1/3); `takenAt` is exactly `YYYY-MM-DDTHH:MM:SSZ`. Sort = `taken_at`, then filename; admin can reorder.

## 5. Core flows

### 5.1 Sync (cron + button) — `app/lib/server/sync.ts`
1. List child folders of the root → upsert a `galleries` row per folder (new ones start as **draft**, slug = slugified folder name, title = folder name).
2. Change detection: Drive folder `modifiedTime` does NOT reflect changes deep inside it, so use the **Changes API**: keep a `drive_changes_token` in `settings`; if `listChanges(token)` reports nothing changed (and it's not a forced "Sync now"), stop. Otherwise rescan every non-archived gallery: list recipe folders and their set subfolders (paginate, request only `id,name,mimeType,size,modifiedTime,trashed,imageMediaMetadata(width,height,time,rotation)`; the contract's width/height are rotation-corrected). Store the new token only after a successful run.
3. Build photo records with the matching rule (§3; set names and base names match case-insensitively; a case-only set rename updates `set_name` in place, ids unchanged). Upsert. **No hard deletes on a single scan:** a photo whose high-res file is absent gets `photos.missing_since` (ISO) set; if it is present again the column is cleared; it is hard-deleted (with its R2 keys) only when `missing_since` is older than `SYNC_DELETE_GRACE_MS` (1 hour) on a later run (runs keep rescanning while any grace period is pending). If a gallery's high-res folder is missing or has zero JPEGs while the gallery has photos, nothing is marked or deleted and the gallery gets issue `highres_empty`.
4. Store mismatches in `sync_issues_json` (capped at 200 entries + a final `{"truncated": n}` summary); set `use_watermark_preview` if `preview-wm` exists.
5. Stay within Worker limits (T1.3 decision): the scan is **breadth-first with `listChildrenMany`** (root → albums → all recipe folders → all set folders: ~4 queries for the whole library). `runSync` takes a `budget` (default 45; Workers Free allows 50 external subrequests) counting EVERY external call: `listChanges`, `getStartPageToken`, `getMeta(root)`, every scan query and the Google OAuth refresh (the drive factory counts it in `drive.subrequests()`). It checks that the next call fits BEFORE making it and re-checks after; on overrun it aborts with `SyncBudgetError` before any DB write and the changes token is not stored. D1/R2 calls are a separate pool (limit 1000): a counter aborts above 900. D1 writes are chunked into batches of <=100 statements per gallery (ordered so a failure mid-gallery leaves consistent rows; the next run re-diffs). A `sync_lock` settings row (5 min expiry) prevents overlapping runs. `listChanges` falls back to a full rescan only on 400/404 (stale token); other errors are rethrown.
6. **Archived on removal (with grace):** an album folder that disappears or is trashed first gets `galleries.folder_missing_since`; only after `SYNC_DELETE_GRACE_MS` is the gallery set to `archived` and its previous status stored in `archived_prev_status` (rows and photos are kept). If the folder returns, `folder_missing_since` is cleared and, when `archived_prev_status` is set, the previous status is restored. If the root listing is empty while galleries exist, the run aborts (console error, no writes, token not stored, result `skipped: "empty_root"`). Renaming a folder never changes an existing gallery's slug/title/status.
7. **Mock auto-publish:** when `DRIVE_MODE=mock`, new galleries are created `published` (instead of `draft`) so the seeded galleries are viewable immediately.

### 5.2 Client views gallery
`/:slug` → PIN form if needed → cookie. Draft/expired/archived → "gallery unavailable" page. Justified grid of thumbs (using width/height), sets as tabs, lightbox showing `web` (or `preview-wm` when watermark is on), keyboard + swipe, preload next. Log one `gallery_views` row per session; skipped for HEAD, prefetch (`Purpose`/`Sec-Purpose`) and bot UAs, and cookieless views are deduped per (gallery, hashed IP) within 30 min. Unlock redirects to `/` + `encodeURIComponent(slug)` (+ `?lang=` if valid), never the raw pathname; missing `CF-Connecting-IP` is "local" in mock mode and otherwise null (`clientIpHash`): PIN/visitor endpoints answer 429, views are logged with `ip_hash` NULL (no dedupe bucket); unknown-slug POSTs share a per-IP limiter (pseudo-gallery `unknown`). The locked screen shows the gallery title (accepted studio choice). **All client queries filter `photos.missing_since IS NULL`, via the shared `photoVisible` predicate (`app/db/index.ts`)** (photos in their sync grace period are hidden from clients).

### 5.3 Images route — `/img/:photoId/:variant` (`thumb` | `view-sm` | `view-lg`)
Check gallery cookie for that photo's gallery → try R2 `<photoId>/<variant>` → on miss, stream from Drive (`files/<id>?alt=media`), `tee()` the body into R2 and the response. `Cache-Control: private, max-age=600`, ETag/304. A blank/unparseable Drive Content-Length counts as absent (streamed uncached). Accepted: browsers may keep a stale image up to 10 min after a watermark toggle or re-export.
- `thumb` → thumb (fallbacks per §3)
- `view-sm` → web 1200 (lightbox on phones, via `srcset`/`sizes`)
- `view-lg` → high-res 2048 (lightbox on large/retina screens)
- When watermark is on, both `view-*` serve `preview-wm`; `thumb` falls back to `thumb ?? preview-wm` (never clean web/high-res), 404 if neither.
Cache rules (one paragraph): R2 objects carry `httpMetadata.contentType` and `customMetadata {fileId, wm: "0"|"1", v}` (server-side only, never in responses), where `v` is the resolved source file's Drive modifiedTime from `photos.variant_versions`. A hit is valid only if `fileId`, `wm` and `v` equal the current resolved file id, watermark flag and version; otherwise it is a miss and the object is overwritten, so re-exports and watermark toggles need no explicit invalidation (Drive for desktop overwrites in place and keeps the file id). Unknown `v` is never cached; only non-empty bodies (Content-Length > 0) are cached (length 0 → 502). Content-Type passes through if `image/jpeg|png|webp`, else `image/jpeg`.

R2 cache keys are exactly `<photoId>/thumb`, `<photoId>/view-sm` and `<photoId>/view-lg`. Image routes must not serve photos with `missing_since` set. When sync hard-deletes photos it removes those three keys per photo with ONE `CACHE.delete(keys[])` per <=1000 keys; on failure the ids stay in settings `r2_pending_deletes` (JSON, capped at 2000) and are retried first thing on the next run. The cron handler stores `sync_last_error` (`{at, message}`, generic text) for failures and for `no_root`/`empty_root` skips, and clears it on success; it rethrows so Cron shows the failure.

### 5.4 Email gate
If `require_email`, the first download or favorite opens an email (+ optional name) form → upsert `visitors` (normalize email with trim + lowercase before insert/lookup; the DB unique index is also NOCASE; shared regex in `app/lib/email.ts`) → visitor id in the cookie. Server gate: `requireVisitor` (`app/lib/server/access.ts`): `require_email && (no visitor || anonymous)` → `403 email_required`.
API (JSON, `Cache-Control: no-store`, cross-site POSTs rejected):
- `POST /api/g/:slug/visitor {email, name?}` → registers the visitor and sets the session cookie (rate limit scope `visitor:`).
- `GET /api/g/:slug/favorites` → `{visitor, favorites[]}`; `POST /api/g/:slug/favorites {photoId, on}` toggles one favourite (cap 2000 visible favourites; anonymous visitors, scope `anon:`, only when `require_email=0`).

### 5.5 Download
Client photo payload (`GalleryPhoto`) carries `variants: { web: boolean; ig: boolean }` (high-res is always present). **Downloads never fall back between sizes**: a missing web/ig makes that option unavailable (`unavailable[]` at issue time, 410 at `/dl`). The §3 viewing fallbacks are unchanged.
1. `POST /api/g/:slug/download-tokens {photoIds[1..50 unique], variant: "highres"|"web"|"ig", bulkId?}` (JSON, `no-store`): cross-site 403 → `openGallery` (404 parity) → body 400 → `requireVisitor` (`403 email_required`; anonymous visitors are created like favourites, scope `anon:`, when `require_email=0`) → variant flag else `403 variant_disabled` → `allow_bulk` required when >1 id or `bulkId` (`403 bulk_disabled`) → rate limit `dl:` 120/10 min (429) → `{tokens: [{photoId, url: "/dl/<token>", filename, bytes?}], missing[], unavailable[]}`. Ids not in this gallery / not `photoVisible` go to `missing`; photos lacking the variant to `unavailable`. `filename` = `<base_name>.jpg` | `-web.jpg` | `-ig.jpg` (path separators and control chars stripped, unicode kept); `bytes` only for high-res. A `bulkId` must be a bulk row of this gallery (else 400).
2. Token: `signToken` with `DOWNLOAD_SECRET`, TTL 10 min, payload `{t:"dl", jti, g, p, v, vid, pf: pinFingerprint(pin_hash), b?: bulkId}`.
3. `GET|HEAD /dl/:token` → verify HMAC + expiry, reload the gallery: available, `pf` equals the current PIN fingerprint (a PIN change/clear revokes), photo `photoVisible` in that gallery, variant still allowed and present; any failure (also bad/expired token) → the same generic `410`. Logs `INSERT OR IGNORE INTO downloads` keyed by `token_id = jti` (so retries/resumes log once; HEAD never logs; `kind` = bulk if `b`; country from `cf`, UA cut to 200). Google mode: `drive.streamFile(fileId, {range})` passthrough (Range → 206), `Content-Type` allowlisted (default `image/jpeg`), `Content-Length`/`Content-Range` from upstream, `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<pct>`, `Cache-Control: private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`. Mock mode: log, then 302 to `mockImageUrl(photo.id, variant, w, h)`. Drive 404 → 410, other errors → 502. Downloads always serve the **clean** files, never `preview-wm`. No buffering.
4. Access token: `app/lib/server/google-auth.ts#getAccessToken(env, {forceRefresh?})` refreshes from the stored refresh token, caches in `settings` until 5 min before expiry; on 401 refresh once and retry.

### 5.6 Download all / set
`POST /api/g/:slug/bulk {scope: "all"|"set"|"favorites", set?, variant}` (same gates, `allow_bulk` required, shares the `dl:` limit) inserts ONE `downloads` row (`kind=bulk`, `photo_id` NULL) and returns `{bulkId, photoIds (visible, gallery order, filtered by scope and by having the variant; favourites = the current visitor's), totalBytes? (high-res only)}`. Browser: request tokens in batches of 50 (passing `bulkId`) → fetch each `/dl/<token>` → `client-zip` → `showSaveFilePicker` when available, else Blob fallback with a warning above ~2 GB. The per-photo rows come from the `/dl` hits.

### 5.7 Admin (behind Cloudflare Access)
- **Setup page:** Connect Google (OAuth), pick root folder (paste link or ID), branding (studio name, logo URL; no accent colour: the palette is monochrome).
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
- **Colour:** near-white background (#FAFAF8-ish), near-black text, monochrome (no accent colour). Dark lightbox. Optional dark gallery theme per album.
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
- Images: In mock mode the /img and /dl routes (not the Drive mock) respond with a 302 to `mockImageUrl(photoId, variant, width, height)` (`photoId` = the DB `photos.id`, never a Drive id; width/height = the photo row's, giving the aspect ratio); i.e. a **302 redirect** to `https://picsum.photos/seed/<photoId>/<w>/<h>` using the right size for each variant (thumb 600, web 1200, ig 1080, high-res 2048 long edge). The browser fetches them; the Worker never does (the dev sandbox can't reach picsum anyway). No R2 caching in mock mode.
- Download logging, favorites, PIN etc. all work normally against local D1.
- `pnpm seed` runs a mock sync so the admin and galleries are populated.

## 6. Security rules
- Never expose Drive file IDs, R2 keys or tokens to the client.
- Every client route checks the gallery cookie **and** that the photo belongs to that gallery **and** gallery is published + not expired.
- PIN: PBKDF2-SHA256 (Web Crypto), 100k iterations, random salt; max 5 attempts / 10 min per IP+gallery, via the shared `rateLimit` helper (`pin:` scope in `rate_limits`, §4).
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
- [x] **T1.3 Sync engine** (after T1.1, T1.2, T1.4). `sync.ts` per §5.1 (takes a `DriveClient`), `getDrive(env)` factory (mock vs google), `scheduled` handler, `POST /api/admin/sync`, `pnpm seed` (mock sync into local D1). *Accept:* tests on the mock fixtures: sets, fallbacks, mismatch reporting, deletion, wm detection, reserved/duplicate slugs, idempotent re-run, changes-token skip.

- [x] **T1.4 ∥ Mock Drive + fixtures** per §5.9: `app/lib/server/drive-mock.ts` (`createMockDrive(fixtures)`: DriveClient) + `fixtures.ts` + `mockImageUrl(photoId, variant, width, height)` helper for picsum (first arg is the DB `photos.id`). Fixture tree mirrors §3 exactly (root `381studios` → album folders → recipe folders → optional set subfolders). Includes a mutation API for tests (add/remove/rename file → bumps changes token).

### Phase 2 — Client gallery
- [x] **T2.0 Foundations** (first). Design tokens in `app/app.css` per §5.8 (colours, type scale, spacing, motion durations, z-layers), icon set (`app/components/icons.tsx`, thin 1.5px stroke, inline SVG, no icon library), placeholder logos `public/brand/logo-black.svg` / `logo-white.svg` (text "381 STUDIOS" in Montserrat light, to be replaced by the real files), i18n infra (`app/i18n/{es,en}.ts` typed key set, `getLang(request)` per §2, `t()` helper + `useT()` hook via root loader, `<html lang>` set, ES/EN footer toggle component), root ErrorBoundary restyled + translated. *Accept:* typed keys (missing key in `en` fails typecheck), lang resolution order tested.
- [x] **T2.1 Gallery page + PIN + status/expiry + view logging.** `app/routes/$slug*.tsx`, `PinForm`. *Accept:* sessions carry the PIN fingerprint `pf` (`pinFingerprint()` in `auth.ts`; `readGallerySession(request, {id, pinHash}, env)` rejects a mismatch, so changing/clearing the PIN logs visitors out); all photo queries use `photoVisible`.
- [x] **T2.2 Grid + Lightbox components.** `app/components/Grid.tsx`, `Lightbox.tsx` (justified layout, keyboard, swipe, preload). *Accept:* all photo queries use `photoVisible`.
- [x] **T2.3 Images route** per §5.3 with R2 read-through cache. *Accept (carried from T1.4 review):* in mock mode the 302 Location seed equals the DB photo id and never contains any drive_*_id; call `mockImageUrl(photo.id, variant, photo.width, photo.height)` with the row's width/height. All photo queries use `photoVisible`.
- [x] **T2.4 Email gate + favorites** (after T2.1). `EmailGate.tsx`, visitor + favorites API, heart button in grid and lightbox. *Accept:* all photo queries use `photoVisible`.

### Phase 3 — Downloads
- [x] **T3.1 Token endpoint + `/dl/:token`** per §5.5. *Accept:* integration test streams a mocked Drive body without buffering; expired → 410; no download variant ever returns the preview-wm file; all photo queries use `photoVisible`.
- [ ] **T3.2 Download UI.** `DownloadMenu.tsx` (High-res / Web / Instagram per flags), download all / set with `client-zip`, progress. *Accept:* all photo queries use `photoVisible`.

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

If sync hits Free plan CPU (10 ms) or subrequest limits on very large libraries, Workers Paid ($5/month) lifts them; the sync aborts cleanly rather than corrupting data.
