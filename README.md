# 381s-galleries

Client photo galleries for **381 Studios** — a free, self-hosted Pixieset alternative.

- Capture One exports every size (high-res 2048, web 1200, ig 1080, thumb 600, optional watermarked preview) into a Google Drive folder.
- The app reads that folder and serves branded galleries at `https://gallery.381studios.ar/<slug>`: PIN, expiry, QR sharing, favorites, multi-size downloads and download tracking.
- Runs on Cloudflare Workers + D1 + R2 (cache). No servers.

See [PLAN.md](PLAN.md) for the full spec and task list, and [DEPLOY.md](DEPLOY.md) (Spanish) for the step-by-step deployment guide (browser-only: GitHub Actions deploys; run the **Setup** workflow once, then merges to `main` deploy automatically).

## Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars   # then edit it, see below
pnpm db:migrate:local            # apply migrations to the local D1
pnpm dev                         # http://localhost:5173
pnpm seed                        # in a second terminal (dev server must be running)
```

In `.dev.vars`:

- `SESSION_SECRET`, `DOWNLOAD_SECRET` and `TOKEN_KEY`: each a random value of at least 32 characters, e.g. `openssl rand -base64 32`.
- `DRIVE_MODE=mock` and `ALLOW_DEV_ADMIN=1` (already set in the example; `ALLOW_DEV_ADMIN` must never be set in production).
- `PUBLIC_ORIGIN=http://localhost:5173`: the origin used for share links, QR codes and the print card (https in production, http only for localhost; otherwise the request origin is used).

Then open <http://localhost:5173/admin>.

`pnpm seed` calls the running dev server (`POST /api/admin/sync`), so `pnpm dev` must be up first. The mock Drive tree is in-memory and deterministic, so seeding again is idempotent.

**After pulling, run `pnpm db:migrate:local`**: new migrations (currently up to `0009`) are applied to the local D1.

## Admin on phones

Every admin screen is designed for 360x740 first and must stay good at 768 and 1280: the sidebar becomes a top bar with a "Menú" toggle, the galleries list stacks as cards below 1280, tap targets are >= 44px and form fields 16px (no iOS zoom) below 768. To check all screens at 360, 768 and 1280 against a running dev server (mock mode, seeded):

```sh
pnpm dev                       # terminal 1
pnpm seed                      # once
node scripts/check-admin-mobile.mjs [--base http://localhost:5173] [--shots DIR]
```

It needs Playwright with a Chromium (`npm i -g playwright`; it uses Chrome if installed), is not part of `pnpm test`, exits non-zero on horizontal overflow, controls under 44px, form fields under 16px or dialogs that overflow, and with `--shots` saves one PNG per screen and width. Photos are faked in the browser, so it works offline.

## Routes

- `/:slug`: client gallery (PIN form, grid, lightbox); `?lang=es|en` switches language (also sets a cookie)
- `/img/:id/:variant`: photo images (`thumb`, `view-sm`, `view-lg`), cached in R2 (a free 1-minute cron pre-fills `thumb` and `view-sm`; the admin setup page shows "Fotos en caché: N / M" = photos already warmed / visible photos; image URLs carry `?v=` so browsers keep them for a year)
- `/api/g/:slug/*`: client JSON API (`visitor`, `favorites`, `download-tokens`, `bulk`)
- `/dl/:token`: signed download of one photo (GET/HEAD; tokens from `download-tokens`, valid 10 min)
- `/api/g/:slug/download-tokens`: POST, issues up to 50 `/dl` tokens
- `/api/g/:slug/bulk`: POST, plans "download all / set / favorites" (the browser zips)
- `/admin`: galleries list (`?estado=todas|publicadas|borradores|archivadas`), Cloudflare Access
- `/admin/setup`: connect Google, root folder, studio name, "Sync now"
- `/admin/google/connect`, `/admin/google/callback`: Google OAuth flow
- `/admin/g/:id`: edit gallery (details, PIN, expiry, status, flags, cover, reorder, share panel + QR)
- `/admin/g/:id/card`: printable A6 card (`?lang=es|en`)
- `/admin/g/:id/activity`: views and downloads; `/admin/g/:id/activity.csv`: CSV export
- `/admin/g/:id/favorites`: favorites per visitor; `/admin/g/:id/favorites.txt`: base names for Capture One
- `/admin/img/:photoId/:variant`: admin thumbnails (`thumb`, `view-sm`), `private, no-store`
- `/api/admin/sync`: "Sync now" (POST, admin only, same-origin only)
