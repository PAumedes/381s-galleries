# 381s-galleries — client galleries for 381 Studios (Pixieset alternative)

> Live at **https://session.381studios.ar/<slug>** · Repo: `PAumedes/381s-galleries`
> This file is the single source of truth for the build. Every subagent reads the sections it needs before starting a task.
> Agents implement **one task at a time**, touch only the files listed for that task, and stop when the acceptance criteria pass.

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
| Web framework | **React Router (framework mode, v8 at scaffold time)** on Cloudflare Workers, using Cloudflare's official React Router template (`@cloudflare/vite-plugin`) | First-class Workers support; loaders/actions give SSR + API in one project; React is the stack agents write most reliably |
| Styling | **Tailwind CSS v4** | Predictable for agents, no separate CSS architecture to maintain |
| DB | Cloudflare D1 + **Drizzle ORM** (`drizzle-orm/d1`), migrations with `drizzle-kit` → `wrangler d1 migrations` | Typed queries, fewer SQL bugs |
| Image source | Google Drive API v3, **read-only** (`https://www.googleapis.com/auth/drive.readonly`) | Files are created by Drive for desktop, not by the app, so `drive.file` can't see them |
| Preview cache | R2 bucket `revelado-cache`, key `<photoId>/<variant>`; filled lazily on first request | Fast repeat views, fewer Drive calls |
| Google auth | OAuth **Web application** client. Admin clicks "Connect Google" once; the Worker runs the OAuth flow and stores the refresh token (encrypted with `TOKEN_KEY`) in D1. Consent screen **In production** (unverified is fine for personal use; you'll see a warning screen once) | No local scripts |
| Admin auth | **Cloudflare Access** on `/admin*` and `/api/admin*`. App trusts `Cf-Access-Authenticated-User-Email` and checks it equals `ADMIN_EMAIL` | No login code |
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
               UNIQUE(gallery_id, set_name, base_name))
visitors      (id PK, gallery_id FK, email, name?, first_seen, UNIQUE(gallery_id, email))
favorites     (visitor_id FK, photo_id FK, list_name default 'Favoritos', comment?, created_at,
               PK(visitor_id, photo_id, list_name))
downloads     (id PK, gallery_id, photo_id?, visitor_id?, variant: 'highres'|'web'|'ig',
               kind: 'single'|'bulk', country?, ua?, created_at)
gallery_views (gallery_id, visitor_id?, country?, created_at)
pin_attempts  (ip_hash, gallery_id, count, window_start)  // rate limit
```

Width/height/taken_at come from Drive's `imageMediaMetadata` (no EXIF parsing in code). Sort = `taken_at`, then filename; admin can reorder.

## 5. Core flows

### 5.1 Sync (cron + button) — `app/lib/server/sync.ts`
1. List child folders of the root → upsert a `galleries` row per folder (new ones start as **draft**, slug = slugified folder name, title = folder name).
2. For each non-archived gallery whose Drive `modifiedTime` changed since `drive_modified_at` (or "Sync now" forced): list recipe folders and their set subfolders (paginate, request only `id,name,size,imageMediaMetadata(width,height,time),parents`).
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
If `require_email`, the first download or favorite opens an email (+ optional name) form → upsert `visitors` → visitor id in the cookie.

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
- Images: `/img` and `/dl` respond with a **302 redirect** to `https://picsum.photos/seed/<photoId>/<w>/<h>` using the right size for each variant (thumb 600, web 1200, ig 1080, high-res 2048 long edge). The browser fetches them; the Worker never does (the dev sandbox can't reach picsum anyway). No R2 caching in mock mode.
- Download logging, favorites, PIN etc. all work normally against local D1.
- `pnpm seed` runs a mock sync so the admin and galleries are populated.

## 6. Security rules (all agents)
- Never expose Drive file IDs, R2 keys or tokens to the client.
- Every client route checks the gallery cookie **and** that the photo belongs to that gallery **and** gallery is published + not expired.
- PIN: PBKDF2-SHA256 (Web Crypto), 100k iterations, random salt; max 5 attempts / 10 min per IP+gallery.
- Constant-time comparison for HMACs.
- Refresh token stored AES-GCM encrypted (`TOKEN_KEY`).
- Secrets only via `wrangler secret put` / `.dev.vars` (gitignored).

## 7. Task breakdown

Status: `[ ]` todo · `[~]` in progress · `[x]` done. Agents update only their own task's checkbox.
Tasks marked **∥** within a phase touch disjoint files and can run in parallel.

### Phase 0 — Foundation (sequential)
- [x] **T0.1 Scaffold.** Cloudflare React Router template, Tailwind v4, Drizzle, Vitest (workers pool), ESLint/Prettier, `wrangler.jsonc` with `DB`, `CACHE` (R2), cron `*/15 * * * *`, `.dev.vars.example`. *Accept:* `pnpm dev` serves hello page; `pnpm test`, `pnpm build` pass.
- [x] **T0.2 Schema.** `app/db/schema.ts` per §4, first migration, `app/db/index.ts` helper. *Accept:* migration applies locally; test inserts/reads a gallery.
- [x] **T0.3 Crypto + auth utils.** `app/lib/server/crypto.ts` (HMAC, PBKDF2, AES-GCM, ids), `app/lib/server/auth.ts` (gallery cookie, admin guard). *Accept:* unit tests incl. tampered/expired tokens and wrong admin email.

### Phase 1 — Google + sync
- [ ] **T1.1 ∥ Google OAuth.** Routes `/admin/google/connect` + callback, encrypted token storage, `drive.ts#getAccessToken`. *Accept:* tests with mocked token endpoint; refresh-on-401.
- [ ] **T1.2 ∥ Drive client.** `drive.ts`: `listChildren(folderId)` (paginated, minimal fields), `streamFile(id, range?)`, `getFolderMeta(id)`. *Accept:* mocked-fetch tests incl. pagination.
- [ ] **T1.3 Sync engine** (after T1.1, T1.2). `sync.ts` per §5.1 + `scheduled` handler + `POST /api/admin/sync`. *Accept:* fixture-based tests: sets, missing thumb fallback, mismatch reporting, deletion, wm detection.

- [ ] **T1.4 ∥ Mock Drive + fixtures + `pnpm seed`** per §5.9 (can start right after T0.2; T1.3 uses it for tests).

### Phase 2 — Client gallery
- [ ] **T2.1 ∥ Gallery page + PIN + status/expiry + view logging.** `app/routes/$slug*.tsx`, `PinForm`.
- [ ] **T2.2 ∥ Grid + Lightbox components.** `app/components/Grid.tsx`, `Lightbox.tsx` (justified layout, keyboard, swipe, preload).
- [ ] **T2.3 ∥ Images route** per §5.3 with R2 read-through cache.
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
- [ ] **T5.4 Final review** against §6 by the reviewer agent.

### Backlog (not now)
- Email notifications (Resend / Gmail SMTP)
- Mercado Pago checkout for prints/digitals
- Video in galleries
- Wall-monitor kiosk (`/kiosk/:slug` auto slideshow)
- Face search (needs compute outside Workers)

## 8. Definition of done (every task)
1. Acceptance criteria pass.
2. `pnpm lint && pnpm test && pnpm build` green.
3. Only the task's files changed (plus its checkbox in §7).
4. Report back in ≤10 lines: files changed, how to verify, open questions.

## 9. Running with Sonnet subagents (cost control)

Run the **main session on Sonnet** too (`/model sonnet`). Escalate a single task to Opus only if it fails twice.

**`.claude/agents/implementer.md`**
```markdown
---
name: implementer
description: Implements exactly one task from PLAN.md §7. Use for any coding task in this repo.
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash
---
You implement ONE task from PLAN.md. First read PLAN.md §2 (decisions), §6 (security), §8 (done) and your task in §7, plus any §3–§5 section it references.
- Touch only the files your task needs. No unrelated refactors.
- Never change §2 decisions. Never add image processing. If blocked, stop and report the question.
- Write tests for the acceptance criteria.
- Run `pnpm lint && pnpm test && pnpm build` before finishing.
- Mark your task `[x]` in PLAN.md §7.
- Reply in ≤10 lines: files changed, how to verify, open questions.
```

**`.claude/agents/reviewer.md`**
```markdown
---
name: reviewer
description: Reviews a finished task or phase against PLAN.md. Read-only.
model: sonnet
tools: Read, Glob, Grep, Bash
---
Review the given changes against PLAN.md §2, §6 and the task acceptance criteria.
Output only concrete problems: file:line — problem — fix. No praise, no summary. Do not edit files.
```

**`.claude/agents/scout.md`**
```markdown
---
name: scout
description: Looks up library/API docs (React Router, Drizzle, Workers, Drive API) or finds code in the repo.
model: haiku
tools: Read, Glob, Grep, WebFetch, WebSearch
---
Answer in ≤15 lines with the exact snippet or doc reference needed. No code changes.
```

**Orchestration prompt** (main session, once per phase):
```
Read PLAN.md §7. For Phase <N>, launch one `implementer` per task, giving each only its task ID.
Run tasks marked ∥ in parallel, the rest sequentially. When done, run `reviewer` on the phase,
send only the flagged fixes back to an implementer, then stop and summarize in 5 lines.
```

Cost tips: keep `CLAUDE.md` tiny (it loads every turn); one task per subagent; `/compact` between phases.

## 10. `CLAUDE.md` (repo root — keep it this short)
```markdown
# 381s-galleries
Spec and tasks: PLAN.md — read only the sections you need.
- TypeScript strict · React Router on Cloudflare Workers · Tailwind v4 · D1 + Drizzle · R2 cache · Drive API read-only.
- No image processing in code: Capture One makes every size. App never writes to Drive.
- pnpm. Before finishing: pnpm lint && pnpm test && pnpm build.
- Never commit secrets. Never expose Drive IDs, R2 keys or tokens to clients.
```

## 11. Manual steps for the photographer (not for agents)
1. Cloudflare: add custom domain `session.381studios.ar` to the Worker (DNS already on Cloudflare).
2. Google Cloud project → enable Drive API → OAuth **Web** client with redirect `https://<domain>/admin/google/callback` → consent screen **In production**.
3. Cloudflare Zero Trust → Access application for `/admin*` and `/api/admin*` allowing your email.
4. `wrangler secret put`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `DOWNLOAD_SECRET`, `TOKEN_KEY`, `ADMIN_EMAIL`.
5. Drive for desktop syncing `My Drive/381studios`.
6. Capture One: create the recipes from §3, all enabled, output to `…/381studios/[Session Name]/<recipe>`.
7. Admin → Setup → Connect Google → paste root folder → after a sync, publish the gallery and share the link/QR.
