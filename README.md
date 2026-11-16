# 381s-galleries

Client photo galleries for **381 Studios** — a free, self-hosted Pixieset alternative.

- Capture One exports every size (high-res 2048, web 1200, ig 1080, thumb 600, optional watermarked preview) into a Google Drive folder.
- The app reads that folder and serves branded galleries at `https://session.381studios.ar/<slug>`: PIN, expiry, QR sharing, favorites, multi-size downloads and download tracking.
- Runs on Cloudflare Workers + D1 + R2 (cache). No servers.

See [PLAN.md](PLAN.md) for the full spec and task list.

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
- `DRIVE_MODE=mock` and `ALLOW_DEV_ADMIN=1` (already set in the example).

Then open <http://localhost:5173/admin>.

`pnpm seed` calls the running dev server (`POST /api/admin/sync`), so `pnpm dev` must be up first. The mock Drive tree is in-memory and deterministic, so seeding again is idempotent.
