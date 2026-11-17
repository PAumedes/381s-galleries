import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../../app/lib/server/downloads";
import type { DriveClient } from "../../app/lib/server/drive-types";

const db = getDb(env);
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;
beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
const post = (path: string, body: unknown, ip: string) =>
  new Request(`https://s.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });

it("visitor B cannot attach their per-photo downloads to visitor A's bulk header", async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM downloads"),
    env.DB.prepare("DELETE FROM visitors"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
  await db.insert(schema.galleries).values({
    id: "gF",
    driveFolderId: "ff",
    slug: "forge",
    title: "t",
    status: "published",
    requireEmail: false,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: "gF",
    baseName: "A",
    driveHighresId: "h",
    driveWebId: "w",
    driveIgId: "i",
    sort: 1,
  });
  // visitor A (ip 1.1.1.1) creates a bulk header
  const a = (await (
    await handleBulk(
      post("/api/g/forge/bulk", { scope: "all", variant: "web" }, "1.1.1.1"),
      "forge",
      env,
    )
  ).json()) as { bulkId: string };
  // visitor B (no cookie, different ip) reuses A's header id
  const res = await handleDownloadTokens(
    post(
      "/api/g/forge/download-tokens",
      { photoIds: ["p1"], variant: "web", bulkId: a.bulkId },
      "2.2.2.2",
    ),
    "forge",
    env,
  );
  const body = (await res.json()) as { tokens?: { url: string }[] };
  if (!body.tokens) return; // rejected: fine
  const token = body.tokens[0].url.replace("/dl/", "");
  const drive = {
    async streamFile() {
      return new Response(new Uint8Array([0xff, 0xd8]), {
        headers: { "Content-Type": "image/jpeg", "Content-Length": "2" },
      });
    },
  } as unknown as DriveClient;
  await serveDownload(
    new Request(`https://s.test/dl/${token}`),
    token,
    googleEnv,
    { drive },
  );
  const rows = await db.select().from(schema.downloads);
  const header = rows.find((r) => r.id === a.bulkId)!;
  const child = rows.find((r) => r.photoId === "p1");
  expect(child).toBeTruthy();
  if (child!.bulkId === header.id)
    expect(child!.visitorId).toBe(header.visitorId);
});
