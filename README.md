# 381s-galleries

Client photo galleries for **381 Studios** — a free, self-hosted Pixieset alternative.

- Capture One exports every size (high-res 2048, web 1200, ig 1080, thumb 600, optional watermarked preview) into a Google Drive folder.
- The app reads that folder and serves branded galleries at `https://session.381studios.ar/<slug>`: PIN, expiry, QR sharing, favorites, multi-size downloads and download tracking.
- Runs on Cloudflare Workers + D1 + R2 (cache). No servers.

See [PLAN.md](PLAN.md) for the full spec and task list.
