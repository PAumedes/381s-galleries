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
| URLs | Public: `https://session.381studios.ar/<slug>`. Admin: `/admin`. Reserved slugs (rejected by sync, suffixed with `-2`): `admin, api, img, dl, assets, brand, favicon.ico, robots.txt, manifest.webmanifest, privacidad, privacy` | |
| Public origin | `PUBLIC_ORIGIN` var (wrangler.jsonc; `.dev.vars` locally). Share panel/QR/print card build links via `publicGalleryUrl` (`app/lib/server/public-url.ts`): must be https (http only for localhost), else falls back to the request origin | Links never depend on the Host header |
| i18n | **Spanish (default) + English**. Strings in `app/i18n/{es,en}.ts` with a typed key set; language from `?lang=` → cookie → `Accept-Language` → `es`. Small ES/EN toggle in the footer. Admin UI in Spanish only (the only exception: the printable A6 card, ES/EN via `?lang=`) | |
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
               theme: 'light'|'dark' default 'light' [0010],
               drive_modified_at?, last_synced_at?, sync_issues_json?,
               folder_missing_since?, archived_prev_status? ('draft'|'published'),
               archived_by_sync bool=0 (1 = archived by sync's folder-removal rule; only those are auto-restored), created_at)
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
               FK(gallery_id, photo_id) -> photos(gallery_id, id) cascade)   // same-gallery guaranteed by DB; idx (gallery_id, visitor_id) [0009]
downloads     (id PK, gallery_id, photo_id?, visitor_id?, variant: 'highres'|'web'|'ig',
               kind: 'single'|'bulk', token_id? UNIQUE (jti of the /dl token: retries log once),
               bulk_id? (per-photo rows of a bulk run: id of their header row), bulk_scope? (header rows only: 'all'|'favorites'|'set:<name>'), country?, ua?, created_at)
               // indexes: (gallery_id, created_at), (gallery_id, bulk_id) [0009]
               // Activity shape: a bulk HEADER row = kind 'bulk' with photo_id NULL (one per download-all/set, written by /bulk);
               // per-photo rows have photo_id NOT NULL (written by /dl hits; kind 'bulk' when the token carried a bulkId).
               // Anonymous visitors are those with email LIKE '%@anon.invalid'. `activityQuery(db, galleryId)` (`app/lib/server/activity.ts`)
               // returns both kinds joined with the visitor email (null for anon / no visitor): Phase 4 stats and CSV build on it.
gallery_views (gallery_id, visitor_id?, country?, ip_hash?, created_at)  // idx (gallery_id, ip_hash, created_at); cookieless views deduped per (gallery, ip_hash) for 30 min
rate_limits   (key PK, count, window_start)  // the ONE fixed-window limiter (`rateLimit(env, scope, key, max, windowMs)`, `app/lib/server/rate-limit.ts`);
               //   key = `<scope>:<key>`; scopes: `pin:<ip_hash>:<gallery_id>` (5/10 min; pseudo-gallery `unknown`), `visitor:<ip_hash>:<gallery_id>`,
               //   `anon:<ip_hash>:<gallery_id>`, `dl:<ip_hash>:<gallery_id>` (300 token/bulk requests per `DL_WINDOW_MS` = 10 min; every request counts once, refreshes included; 429s carry `Retry-After` = seconds left in the window). Expired rows of a scope are pruned opportunistically.
```

Width/height/taken_at come from Drive's `imageMediaMetadata` (no EXIF parsing in code). The `DriveFile` contract (`drive-types.ts`, shared by the real client and the mock) carries `trashed` and **rotation-corrected** `width`/`height` (the real client swaps them for EXIF rotation 1/3); `takenAt` is exactly `YYYY-MM-DDTHH:MM:SSZ`. Sort = `taken_at`, then filename; admin can reorder.

## 5. Core flows

### 5.1 Sync (cron + button) — `app/lib/server/sync.ts`
1. List child folders of the root → upsert a `galleries` row per folder (new ones start as **draft**, slug = slugified folder name, title = folder name).
2. Change detection: Drive folder `modifiedTime` does NOT reflect changes deep inside it, so use the **Changes API**: keep a `drive_changes_token` in `settings`; if `listChanges(token)` reports nothing changed (and it's not a forced "Sync now"), stop. Otherwise rescan every non-archived gallery: list recipe folders and their set subfolders (paginate, request only `id,name,mimeType,size,modifiedTime,trashed,imageMediaMetadata(width,height,time,rotation)`; the contract's width/height are rotation-corrected). Store the new token only after a successful run.
3. Build photo records with the matching rule (§3; set names and base names match case-insensitively; a case-only set rename updates `set_name` in place, ids unchanged). Upsert. **No hard deletes on a single scan:** a photo whose high-res file is absent gets `photos.missing_since` (ISO) set; if it is present again the column is cleared; it is hard-deleted (with its R2 keys) only when `missing_since` is older than `SYNC_DELETE_GRACE_MS` (1 hour) on a later run (runs keep rescanning while any grace period is pending). If a gallery's high-res folder is missing or has zero JPEGs while the gallery has photos, nothing is marked or deleted and the gallery gets issue `highres_empty`.
4. Store mismatches in `sync_issues_json` (capped at 200 entries + a final `{"truncated": n}` summary); set `use_watermark_preview` if `preview-wm` exists.
5. Stay within Worker limits (T1.3 decision): the scan is **breadth-first with `listChildrenMany`** (root → albums → all recipe folders → all set folders: ~4 queries for the whole library). `runSync` takes a `budget` (default 45; Workers Free allows 50 external subrequests) counting EVERY external call: `listChanges`, `getStartPageToken`, `getMeta(root)`, every scan query and the Google OAuth refresh (the drive factory counts it in `drive.subrequests()`). It checks that the next call fits BEFORE making it and re-checks after; on overrun it aborts with `SyncBudgetError` before any DB write and the changes token is not stored. D1/R2 calls are a separate pool (limit 1000): a counter aborts above 900. D1 writes are chunked into batches of <=100 statements per gallery (ordered so a failure mid-gallery leaves consistent rows; the next run re-diffs). A `sync_lock` settings row (5 min expiry) prevents overlapping runs. `listChanges` falls back to a full rescan only on 400/404 (stale token); other errors are rethrown.
6. **Archived on removal (with grace):** an album folder that disappears or is trashed first gets `galleries.folder_missing_since`; only after `SYNC_DELETE_GRACE_MS` is the gallery set to `archived` and its previous status stored in `archived_prev_status` (rows and photos are kept). The same step sets `archived_by_sync = 1`. If the folder returns, `folder_missing_since` is cleared and the previous status is restored **only for galleries with `archived_by_sync = 1`** (an admin-archived gallery, `archived_by_sync = 0`, stays archived); restoring clears `archived_by_sync`. If the root listing is empty while galleries exist, the run aborts (console error, no writes, token not stored, result `skipped: "empty_root"`). Renaming a folder never changes an existing gallery's slug/title/status.
7. **Mock auto-publish:** when `DRIVE_MODE=mock`, new galleries are created `published` (instead of `draft`) so the seeded galleries are viewable immediately.

### 5.2 Client views gallery
`/:slug` → PIN form if needed → cookie. Draft/expired/archived → "gallery unavailable" page. Justified grid of thumbs (using width/height), sets as tabs, lightbox showing `web` (or `preview-wm` when watermark is on), keyboard + swipe, preload next. Log one `gallery_views` row per session; skipped for HEAD, prefetch (`Purpose`/`Sec-Purpose`) and bot UAs, and cookieless views are deduped per (gallery, hashed IP) within 30 min. Unlock redirects to `/` + `encodeURIComponent(slug)` (+ `?lang=` if valid), never the raw pathname; missing `CF-Connecting-IP` is "local" in mock mode and otherwise null (`clientIpHash`): PIN/visitor endpoints answer 429, views are logged with `ip_hash` NULL (no dedupe bucket); unknown-slug POSTs share a per-IP limiter (pseudo-gallery `unknown`). The locked screen shows the gallery title (accepted studio choice). **Link previews (Open Graph, `galleryMeta` in `app/lib/og.ts`):** published, unexpired, no-PIN galleries emit og:type/site_name/title (gallery title)/description (`<localized date> · <studio>`)/url (`publicOrigin`+slug)/twitter:card, plus og:image = `${publicOrigin}/img/<coverId>/view-sm` (watermarked file when watermark is on; cookieless works for public galleries) with width/height at a 1200 long edge and alt = title. PIN, locked, unavailable and unknown galleries get generic meta (studio name only, no image, no title leak; locked == unavailable). Preview bots are never logged as views. **All client queries filter `photos.missing_since IS NULL`, via the shared `photoVisible` predicate (`app/db/index.ts`)** (photos in their sync grace period are hidden from clients).

### 5.3 Images route — `/img/:photoId/:variant` (`thumb` | `view-sm` | `view-lg`)
Check gallery cookie for that photo's gallery → try R2 `<photoId>/<variant>` → on miss, stream from Drive (`files/<id>?alt=media`), `tee()` the body into R2 and the response. `Cache-Control: private, max-age=600`, ETag/304. A blank/unparseable Drive Content-Length counts as absent (streamed uncached). Accepted: browsers may keep a stale image up to 10 min after a watermark toggle or re-export.
- `thumb` → thumb (fallbacks per §3)
- `view-sm` → web 1200 (lightbox on phones, via `srcset`/`sizes`)
- `view-lg` → high-res 2048 (lightbox on large/retina screens)
- When watermark is on, both `view-*` serve `preview-wm`; `thumb` falls back to `thumb ?? preview-wm` (never clean web/high-res), 404 if neither.
Cache rules (one paragraph): R2 objects carry `httpMetadata.contentType` and `customMetadata {fileId, wm: "0"|"1", v}` (server-side only, never in responses), where `v` is the resolved source file's Drive modifiedTime from `photos.variant_versions`. A hit is valid only if `fileId`, `wm` and `v` equal the current resolved file id, watermark flag and version; otherwise it is a miss and the object is overwritten, so re-exports and watermark toggles need no explicit invalidation (Drive for desktop overwrites in place and keeps the file id). Unknown `v` is never cached; only non-empty bodies (Content-Length > 0) are cached (length 0 → 502). Content-Type passes through if `image/jpeg|png|webp`, else `image/jpeg`.

R2 cache keys are exactly `<photoId>/thumb`, `<photoId>/view-sm` and `<photoId>/view-lg`. Image routes must not serve photos with `missing_since` set. When sync hard-deletes photos it removes those three keys per photo with ONE `CACHE.delete(keys[])` per <=1000 keys; on failure the ids stay in settings `r2_pending_deletes` (JSON, capped at 2000) and are retried first thing on the next run. The cron handler stores `sync_last_error` (`{at, message}`, generic text) for failures and for `no_root`/`empty_root` skips, and clears it on success; it rethrows so Cron shows the failure.

### 5.4 Email gate
If `require_email`, the first download or favorite opens an email (+ optional name) form → a `visitors` row (normalize email with trim + lowercase; the NOCASE index on (gallery_id, email) is a plain lookup index; shared regex in `app/lib/email.ts`) → visitor id in the cookie. **Visitors are per device, with no email verification:** `POST /visitor` never binds a session to a row created by another session (that would let anyone type a client's email and inherit their name and favourites). Each session gets its own row; if the session already has a visitor, its email/name are updated instead. The same email may therefore appear on several rows. Favourites are per device. Admin views (activity, favourites, CSV, "visitantes con email") group by `lower(email)`, so the same email on two devices shows as one person. Server gate: `requireVisitor` (`app/lib/server/access.ts`): `require_email && (no visitor || anonymous)` → `403 email_required`.
API (JSON, `Cache-Control: no-store`, cross-site POSTs rejected):
- `POST /api/g/:slug/visitor {email, name?}` → `{ok:true}` in every case (never a stored name/email); sets the session cookie when a row is created (rate limit scope `visitor:`).
- `GET /api/g/:slug/favorites` → `{visitor, favorites[]}`; `POST /api/g/:slug/favorites {photoId, on}` toggles one favourite (cap 2000 visible favourites; anonymous visitors, scope `anon:`, only when `require_email=0`).

### 5.5 Download
Client photo payload (`GalleryPhoto`) carries `variants: { web: boolean; ig: boolean }` (high-res is always present). **Downloads never fall back between sizes**: a missing web/ig makes that option unavailable (`unavailable[]` at issue time, 410 at `/dl`). The §3 viewing fallbacks are unchanged.
1. `POST /api/g/:slug/download-tokens {photoIds[1..50 unique], variant: "highres"|"web"|"ig", bulkId?}` (JSON, `no-store`): cross-site 403 → `openGallery` (404 parity) → body 400 → `requireVisitor` (`403 email_required`; anonymous visitors are created like favourites, scope `anon:`, when `require_email=0`) → variant flag else `403 variant_disabled` → `allow_bulk` required when >1 id or `bulkId` (`403 bulk_disabled`) → rate limit `dl:` 300/10 min (429 + `Retry-After`) → `{tokens: [{photoId, url: "/dl/<token>", filename}], missing[], unavailable[]}`. Ids not in this gallery / not `photoVisible` go to `missing`; photos lacking the variant to `unavailable`. `filename` = `<base_name>.jpg` | `-web.jpg` | `-ig.jpg` (path separators and control chars stripped, unicode kept). There is no per-token size: the bulk plan's `totalBytes` is the only byte figure. A `bulkId` must be a bulk row of this gallery (else 400).
2. Token: `signToken` with `DOWNLOAD_SECRET`, TTL 10 min, payload `{t:"dl", jti, g, p, v, vid, pf: pinFingerprint(pin_hash), b?: bulkId}`.
3. `GET|HEAD /dl/:token` → verify HMAC + expiry, reload the gallery: available, `pf` equals the current PIN fingerprint (a PIN change/clear revokes), photo `photoVisible` in that gallery, variant still allowed and present, and `allow_bulk` still on when the token has a bulk id `b`; so turning an `allow_*` flag off, or changing/clearing the PIN, revokes outstanding tokens at once; any failure (also bad/expired token) → the same generic `410`. Logs `INSERT OR IGNORE INTO downloads` keyed by `token_id = jti` (so retries/resumes log once; HEAD never logs; `kind` = bulk if `b`; country from `cf`, UA cut to 200). Google mode: `drive.streamFile(fileId, {range})` passthrough (Range → 206), `Content-Type` allowlisted (default `image/jpeg`), `Content-Length`/`Content-Range` from upstream, `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<pct>`, `Cache-Control: private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`. Mock mode: log, then 302 to `mockImageUrl(photo.id, variant, w, h)`. Drive 404 → 410, other errors → 502. Downloads always serve the **clean** files, never `preview-wm`. No buffering.
4. Access token: `app/lib/server/google-auth.ts#getAccessToken(env, {forceRefresh?})` refreshes from the stored refresh token, caches in `settings` until 5 min before expiry; on 401 refresh once and retry.

### 5.6 Download all / set
`POST /api/g/:slug/bulk {scope: "all"|"set"|"favorites", set?, variant}` (same gates, `allow_bulk` required, shares the `dl:` limit) inserts ONE `downloads` row (`kind=bulk`, `photo_id` NULL) and returns `{bulkId, photoIds (visible, gallery order, filtered by scope and by having the variant; favourites = the current visitor's), totalBytes? (high-res only)}`. Browser: request tokens in batches of 50 (passing `bulkId`) just in time → fetch each `/dl/<token>` → `client-zip` → `showSaveFilePicker` when available, else Blob fallback. Memory warnings (no picker only): always on iOS; on other browsers at an estimate above 1.5 GB (`estimateBytes`: per-photo average until the plan arrives, then the server's `totalBytes` for high-res, which can trigger a confirm after the plan). If the picker fails for a reason other than the visitor cancelling, a confirm ("continue in memory?", `download.pickerFailed`) precedes the Blob fallback. Scope choices: "set" is offered only while a set tab is active, "favorites" only if the visitor has favorites. 429s on token/bulk requests of a run are retried honouring `Retry-After` (capped at 60 s, at most 5 retries) instead of failing the run; a single-photo download fails fast. The per-photo rows come from the `/dl` hits; the single download clicks a plain anchor (no new tab; mock mode just navigates through the 302).

### 5.7 Admin (behind Cloudflare Access)
- **Setup page:** Connect Google (OAuth), pick root folder (paste link or ID), branding (studio name, logo URL; no accent colour: the palette is monochrome).
- **Galleries list:** status, photo count, views, downloads, expiry, sync issues badge, "Sync now".
- **Gallery edit:** title, slug, client, date, PIN set/clear, expiry, status (publish button), flags, cover picker, reorder (drag), sync issues list.
- **Share panel:** link + copy, **QR code** (SVG/PNG via `qrcode`, generated in browser), printable A6 card (QR, title, studio logo).
- **Activity:** views + downloads (who, photo, variant, when, country), CSV export.
- **Favorites:** per visitor/list, **"Copy for Capture One"** → base names joined by spaces (paste into C1 search/filter) + `.txt` download.

**T4.1 decisions:** `/admin` is a layout route (`admin.tsx`; children: index = galleries list, `setup`); every admin response is `Cache-Control: private, no-store` + `X-Robots-Tag: noindex`. Every admin mutation is a React Router action starting with `adminAction(request, env)` (`requireAdmin`, then `crossSite` -> 403; returns the admin email). Setup actions use one form per `intent` (`disconnect`, `root`, `sync`, `studio`) and return `{intent, ok, error?, message?, result?}` (errors in Spanish, never ids/upstream detail). Root folder: paste a folder URL (`/drive/folders/<id>`, `/drive/u/N/folders/<id>`, `open?id=`) or bare id (`[A-Za-z0-9_-]{10,}`); verified with `getMeta` (folder, not trashed); settings `drive_root_id` + `drive_root_name` (the name, not the id, goes to the client). Studio name: setting `studio_name` (1-60 chars, no control chars) overrides env `STUDIO_NAME` (root loader, cached per request). Logo is fixed (no upload; the "logo URL" idea is dropped). New setting `sync_last_ok` (ISO) written by the cron and the Sync-now button; `sync_last_error` is shown in the shell and on the setup page. Review fixes: `runRecordedSync` (`sync.ts`) is the single place that clears `sync_last_error` and writes `sync_last_ok` (every non-skipped run, `unchanged` included); the cron, `POST /api/admin/sync` and the setup button all go through it. `/api/admin/sync` also uses `adminAction` (CSRF: `Sec-Fetch-Site`/`Origin`), so `pnpm seed` sends `Origin` + `Sec-Fetch-Site: same-origin`. Admin times are shown in Buenos Aires time (`app/lib/ba-time.ts`, fixed UTC-3; the shell never prints "UTC"). Admin thumbs are `Cache-Control: private, no-store`.

**T4.2 decisions:** `/admin` lists galleries (tabs via `?estado=todas|publicadas|borradores|archivadas`; non-archived first, then newest). Counts: photos = visible only (`photoVisible`), downloads = per-photo rows only (bulk headers excluded), views = `gallery_views` rows, issues badge = entries + the `truncated` summary. Cover thumb = chosen visible cover, else the first visible photo. Thumbs come from **`/admin/img/:photoId/:variant`** (top-level route, `requireAdmin`, `thumb`|`view-sm` only): `serveImage(..., {admin: true})` skips only the gallery access gate (draft/archived/expired/PIN); same R2 cache, watermark policy and `missing_since` rule. Edit page `/admin/g/:id` (loader 404 for unknown id; actions via `adminAction`, every write `WHERE id = <gallery>`; results `{intent, ok, error?, fieldErrors?, message?, stale?}` in Spanish; one form per intent: `details`, `flags`, `status`, `pin`, `cover`, `reorder`). Details: title 1-120, client <=120, slug lowercased `[a-z0-9]+(-[a-z0-9]+)*` <=60, not reserved, unique NOCASE (confirm dialog + hint that shared links/QR break), event date a real `YYYY-MM-DD`, expiry = Buenos Aires wall clock (fixed UTC-3, no DST) stored as UTC `nowIso` format; date without time = 23:59; empty = never. Status transitions (compare-and-set): publish (draft only), draft (published only), archive (stores `archived_prev_status`), restore (previous status, else draft; clears it). PIN 4-32 chars via `hashPin`, remove sets NULL; the hash is never sent to the client (`hasPin` only); `pf` makes old sessions/download tokens die automatically. `use_watermark_preview` can only be turned on when a visible photo has a `preview-wm` file. Cover must be a visible photo of the gallery (empty = automatic). Reorder: client sends `order` = JSON `{set: [photoId...]}` + `version` = hash of the sorted visible photo ids; the server rejects a stale version (`stale: true`, reload message) or any payload that is not exactly the current visible set with each id in its own set; writes `sort = index within set` only for changed rows via `UPDATE … SET sort = CASE id …` chunks of <=45 ids (<=91 bound params), all chunks in ONE `db.batch` (atomic), each scoped by `gallery_id`. UI: mouse drag-and-drop, plus select (click/Enter/Space) and arrows/Home/End or "Mover antes/después" (touch), quick sorts per set by capture date / name, "Restablecer". Sync owns neither: it changes `use_watermark_preview` only on preview-wm availability transitions, and restores only galleries with `archived_by_sync=1` (migration 0007); admin archive sets `archived_by_sync=0`. Expiry year 2000-2100; text rejects only `\p{Cc}` + bidi controls.

**T4.3 decisions:** share panel on the edit page. Link = `publicGalleryUrl(env, slug)` (`PUBLIC_ORIGIN`, https or localhost http, else the request origin; never the Host header). QR = `qrcode` (lazy import, browser only; SVG and PNG download, error correction M, 2-module quiet zone, black on white). Print card = `/admin/g/:id/card` (resource-style page, `requireAdmin`, `private, no-store`): **A6 portrait (105x148 mm)** via print CSS (`.print-card`), with QR, title, event date, studio name and, when the gallery has a PIN, a blank `PIN: ____` line to write by hand (the PIN is never rendered); `?lang=es|en` (default `es`; anything else = `es`) is the only bilingual admin screen; the screen has a Print button and ES/EN toggle that are hidden when printing.

**T4.4 decisions:** sub-routes under the admin layout, with a shared tab bar (`GalleryTabs`: Datos / Actividad / Favoritos): `/admin/g/:id/activity` (`?visitor=<email>|anon&size=highres|web|ig&cursor=<created_at>|<id>`) and `/admin/g/:id/favorites`; resource routes (outside the layout) `/admin/g/:id/activity.csv` and `/admin/g/:id/favorites.txt[?visitor=<visitorId>]`. All `requireAdmin` (401), unknown gallery 404, `private, no-store`. Migration 0008 adds `downloads.bulk_id` (per-photo rows of a bulk run point to their header; written by `/dl` from the token's `b`, null for single downloads and "multi" tokens) and `downloads.bulk_scope` (header only: `all` | `favorites` | `set:<name>`), so bulk rows nest under their header; older rows stay top-level. Summary cards: views = `gallery_views` rows; visitors = non-anonymous `visitors` rows; photos = per-photo rows (anonymous included); bulks = header rows. Table = top-level rows (headers + rows without a header), newest first, 50 per page, keyset cursor (`created_at`, `id`); filters apply to top-level rows (children follow their header; children capped at 1000 per page); "Visitas" mini-table = latest 50 views. Anonymous = "Anónimo" in activity/CSV (empty email) and "Anónimo #<first 6 of visitor id>" in favorites (shown only when they have favorites). `activityQuery(db, galleryId, opts?)` takes `visitor|variant|before|topLevel|bulkIds|limit`. CSV: UTF-8 BOM, CRLF, columns `datetime_utc,datetime_ar,visitor_email,photo,set,size,kind,bulk_id,country` (header rows have empty photo/set and `bulk_id` = own id), cells starting with `= + - @ \t \r` get a leading `'`, streamed in keyset chunks of 200 (`<slug>-actividad.csv`). Favorites: per visitor/list (count, last activity, thumbs via `/admin/img`), photos in their sync grace period shown greyed "(oculta)" but excluded from Capture One output; "Todos los favoritos" = union with how many visitors picked each (a visitor counts once across lists). Capture One text = base names without image extension, deduped, space-separated (names with whitespace quoted) or comma-separated via a toggle; `.txt` = one name per line.


The app never writes or deletes anything in Drive. To remove photos, delete them in Drive; the next sync picks it up.

### 5.8 Design direction (client-facing UI)
Simple, elegant, minimal, **Pixieset-inspired**: the photos are the interface.
- **Cover:** full-viewport hero with the cover photo, album title in Montserrat (light weight, wide tracking, uppercase), date + studio name small and spaced, a subtle "View gallery" scroll cue. Optional cover layouts later (centered / left / split).
- **Typography:** **Montserrat only** (self-hosted via `@fontsource-variable/montserrat`). Titles: weight 300, uppercase, letter-spacing ~0.2em. UI: weight 400/500, small sizes, uppercase micro-labels with generous tracking.
- **Logos:** black-and-white only. `public/brand/logo-black.svg` on light backgrounds, `public/brand/logo-white.svg` on dark ones and over the cover photo. The palette stays monochrome (black, white, warm greys); no accent colour.
- **Colour:** near-white background (#FAFAF8-ish), near-black text, monochrome (no accent colour). Dark lightbox. Dark gallery theme per album (`galleries.theme`, admin Opciones "Tema"): `data-theme="dark"` on the gallery root swaps paper/ink/greys in `app.css`, top-bar logo becomes the white one; cover and lightbox unchanged; PIN screen follows the theme.
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
- PIN: PBKDF2-SHA256 (Web Crypto), 100k iterations, random salt; max 5 attempts / 10 min per IP+gallery (IPv6 keyed on the /64) and 100 / 10 min per gallery across all IPs (`pinG:`; sessions already unlocked are never throttled and POST is a no-op redirect). Trade-off: a gallery-wide cap lets an attacker lock guests out for a window, but bounds brute force; with the 6-char minimum, 100 / 10 min means ~70 days worst case for a numeric 6-digit PIN (10^6 / 100 * 10 min), and a guest can still be locked out for up to 10 min under attack, via the shared `rateLimit` helper (`pin:` scope in `rate_limits`, §4). New PINs need >= 6 characters (older, shorter ones keep working).
- Security headers on every response (`workers/app.ts` -> `applySecurityHeaders`): CSP with a per-request nonce (`app/entry.server.tsx`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- `/img` R2 misses: `img:<ipHash>:<gid>` 5000 / 10 min -> 429 before Drive is called.
- `SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY` must all differ (`assertDistinctSecrets`).
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
- [x] **T3.2 Download UI.** `DownloadMenu.tsx` (High-res / Web / Instagram per flags), download all / set with `client-zip`, progress. *Accept:* all photo queries use `photoVisible`.

### Phase 4 — Admin UI
- [x] **T4.1 ∥ Setup page** (connect Google, root folder, branding). Layout route `admin.tsx` (requireAdmin for all children, sidebar/top bar, status), `admin.setup.tsx`, `adminAction()` in `app/lib/server/admin.ts`. See §5.7.
- [x] **T4.2 ∥ Galleries list + gallery edit** (incl. reorder, cover, sync issues, publish).
- [x] **T4.3 ∥ Share panel + QR + print card.**
- [x] **T4.4 ∥ Activity + favorites views, CSV, "Copy for Capture One".**

### Phase 5 — Polish & deploy
- [x] **T5.1 Branding/theme**, dark/light, OG image (cover via `/img`), full i18n per §2 (es + en).
- [x] **T5.2 PWA** manifest + "add to home screen". Per-gallery manifest at `/api/g/:slug/manifest.webmanifest` (`app/lib/server/manifest.ts`, `app/lib/pwa.ts`): same privacy rules as og (only published, unexpired, PIN-less galleries expose title/slug; everything else gets the generic studio manifest, start_url `/`), `private, max-age=300`. Generic `public/manifest.webmanifest` linked from root. Icons in `public/icons/` generated manually by `scripts/make-icons.mjs` (`@resvg/resvg-js`, dev only; no runtime image processing). iOS meta tags + theme-color per theme. **No service worker** (deliberate: keeps it simple; downloads use the File System Access API, nothing needs offline). `AddToHomeHint` (mobile/coarse pointer, not standalone, after scrolling into the grid, once per gallery via `localStorage a2hs:<slug>`): Android/Chrome button on the captured `beforeinstallprompt`, iOS Safari share instructions, other browsers nothing. Known limit: PIN galleries install as the generic studio app (start_url `/`), by design. The gallery cookie (SameSite=Lax, Path=/) survives in standalone mode.
- [x] **T5.3 `DEPLOY.md`:** Cloudflare (D1, R2, secrets, Access app, custom domain), Google Cloud (Drive API, OAuth web client, redirect URI, In production), Capture One recipe setup.
- [x] **T5.4 Final review** against §6 (security review).
- [x] **T5.5 Deploy from GitHub Actions:** `scripts/setup-cloudflare.mjs` + `.github/workflows/{setup,deploy,ci}.yml`; DEPLOY.md rewritten browser-first. Hardening: secrets only on the Setup/Deploy steps (no job-level env), actions pinned to commit SHAs + Dependabot (weekly), tolerant JSON parsing of wrangler output, `database_id` rewrite scoped to the `381s-galleries` d1 entry (comments ignored), commit-back with `git pull --rebase` and a clear `::error::`, subprocess test with a fake `pnpm`.
- [x] **T5.6 Privacy page:** public `/privacy` (canonical, registered in the Google OAuth consent screen; es/en by lang; Logo, studio name from settings; optional `PUBLIC_CONTACT_EMAIL` var, unset by default, else a generic contact line); `/privacidad` 301-redirects to it (keeps `?lang`). Both reserved slugs. "Privacidad" footer link on gallery pages and home (`SiteFooter`).

### Phase 6 — Feedback round (after first real use)
- [x] **T6.1 Lightbox rapid navigation** — fast prev/next clicks or key repeats leave the lightbox in a broken state; fix races (stale loads, fades, preloads).
- [ ] **T6.2 Image speed** — warm the R2 cache after sync (cron batches within the subrequest budget) + Cloudflare Cache API layer after access checks; avoid Drive on first view where possible.
- [ ] **T6.3 Prueba / Entrega mode** — one switch per gallery. Prueba: watermarked cover, grid (optional `thumb-wm` recipe, fallback `preview-wm`) and lightbox, downloads off, image protection (no right-click/drag/long-press save, images behind a transparent layer). Entrega: clean images, downloads per size flags.
- [ ] **T6.4 Gallery editor rework** — one Photos panel (order + "Usar como portada"), live cover preview with focal point, client name shown/searchable in the list.
- [ ] **T6.5 Themes** — theme presets (Claro, Oscuro, Arena, Gris), cover layouts, grid styles, spacing; Pixieset-like design panel.
- [ ] **T6.6 Public portfolio home** — per-gallery "Mostrar en la portada" (published, no PIN only); home shows a cover grid.
- [ ] **T6.7 Admin in English** — ES/EN toggle in the admin.
- [ ] **T6.8 Subdomain rename** — new public hostname; old one 301-redirects.

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
The step-by-step guide (Spanish) is **[DEPLOY.md](DEPLOY.md)**; it is the single source of truth for setup, the environment table (which values are secrets vs `wrangler.jsonc` vars), deploy order, Capture One recipes and troubleshooting. Deployment is entirely from GitHub Actions: the manual **Setup** workflow (`scripts/setup-cloudflare.mjs`: ensures D1/R2, writes `database_id`, deploys, then uploads secrets; generated secrets are never regenerated) and the **Deploy** workflow on push to main (both use the `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` GitHub secrets; CI on PRs only). `pnpm run deploy` applies the remote migrations, builds and deploys (`pnpm deploy` without `run` is a pnpm built-in); `pnpm secrets:check` verifies the required secrets exist and that `ALLOW_DEV_ADMIN` does not. `ALLOW_DEV_ADMIN` is local only (`.dev.vars`) and must never be set in production.

If sync hits Free plan CPU (10 ms) or subrequest limits on very large libraries, Workers Paid ($5/month) lifts them; the sync aborts cleanly rather than corrupting data.
