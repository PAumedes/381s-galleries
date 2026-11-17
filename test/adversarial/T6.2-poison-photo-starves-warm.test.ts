import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { DriveError } from "../../app/lib/server/drive-types";
import { warmBatch, warmProgress } from "../../app/lib/server/warm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

function drive(
  failIds: (id: string) => boolean,
  headers: Record<string, string> = { "Content-Length": String(JPEG.length) },
) {
  let subs = 0;
  return {
    subrequests: () => subs,
    async streamFile(id: string) {
      subs++;
      if (failIds(id)) throw new DriveError(404, "x", "gone");
      return new Response(JPEG.slice(), { headers });
    },
  } as unknown as DriveClient;
}

async function mk(gid: string, created: number, ids: string[]) {
  await db.insert(schema.galleries).values({
    id: gid,
    driveFolderId: "f" + gid,
    slug: "s" + gid,
    title: "T",
    status: "published",
    createdAt: nowIso(new Date(Date.UTC(2026, 0, 1, 0, 0, created))),
  });
  for (const id of ids)
    await db.insert(schema.photos).values({
      id,
      galleryId: gid,
      baseName: id,
      driveHighresId: "HI-" + id,
      driveWebId: "WEB-" + id,
      driveThumbId: "TH-" + id,
      variantVersions: JSON.stringify({ web: "w", thumb: "t" }),
    });
}

it("permanently failing photos in the newest gallery must not starve healthy photos forever (needs back-off)", async () => {
  const bad = Array.from({ length: 45 }, (_, i) => `bad${i}`);
  await mk("g-old", 1, ["good"]);
  await mk("g-new", 2, bad);
  const d = drive((id) => id.includes("bad"));
  for (let run = 0; run < 5; run++) await warmBatch(e, { drive: d });
  const [g] = await db
    .select()
    .from(schema.photos)
    .where(eq(schema.photos.id, "good"));
  expect(g.cacheWarmKey).not.toBeNull();
});

it("a photo whose Drive response lacks Content-Length is counted as cached although nothing is in R2", async () => {
  await db.delete(schema.galleries);
  await mk("g-nl", 3, ["nolen"]);
  const r = await warmBatch(e, { drive: drive(() => false, {}) });
  expect(await env.CACHE.head("nolen/thumb")).toBeNull();
  const prog = await warmProgress(e);
  // counter claims cached while R2 is empty
  expect(r.warmed === 0 || prog.warmed === 0).toBe(true);
});
