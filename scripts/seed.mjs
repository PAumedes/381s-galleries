// Runs a mock sync against the local dev server (`pnpm dev` must be running
// with DRIVE_MODE=mock and ALLOW_DEV_ADMIN=1 in .dev.vars).
const url = process.env.SEED_URL ?? "http://localhost:5173/api/admin/sync";

try {
  const res = await fetch(url, { method: "POST" });
  const body = await res.text();
  console.log(`${res.status} ${body}`);
  if (!res.ok) process.exit(1);
} catch {
  console.error(
    `Could not reach ${url}. Is \`pnpm dev\` running (DRIVE_MODE=mock, ALLOW_DEV_ADMIN=1)?`,
  );
  process.exit(1);
}
