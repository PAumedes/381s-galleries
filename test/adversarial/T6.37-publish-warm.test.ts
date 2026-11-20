import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import {
  OPEN_WARM_RATE,
  warmGalleryAtPublish,
} from "../../app/lib/server/gallery-warm";
import { warmProgress } from "../../app/lib/server/warm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const G = "gggggggg-0000-0000-0000-0000000037ad";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "adv-t637",
    title: "T",
    status: "published",
  });
  for (let i = 0; i < 5; i++)
    await db.insert(schema.photos).values({
      id: `a${i}`,
      galleryId: G,
      baseName: `a${i}`,
      driveHighresId: `HI-${i}`,
      driveWebId: `WEB-${i}`,
      driveThumbId: `TH-${i}`,
      variantVersions: JSON.stringify({
        highres: "2026-01-01T00:00:01Z",
        web: "2026-01-01T00:00:02Z",
        thumb: "2026-01-01T00:00:03Z",
      }),
    });
});

function drive(
  opts: { fail?: boolean; onCall?: (n: number) => Promise<void> } = {},
) {
  let subs = 0;
  const calls: string[] = [];
  const d = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs++;
      await opts.onCall?.(calls.length);
      if (opts.fail) throw new Error("drive 503");
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { d, calls };
}

describe("T6.37 adversarial", () => {
  it("cover warm respects the sync lock (sync may be replacing/removing photos)", async () => {
    await db.insert(schema.settings).values({
      key: "sync_lock",
      value: new Date(Date.now() + 60_000).toISOString() + "|x",
    });
    const { d, calls } = drive();
    await warmGalleryAtPublish(e, d, G);
    expect(calls).toHaveLength(0);
  });

  it("repeated publish with a failing Drive is bounded by the warm rate rule", async () => {
    const { d, calls } = drive({ fail: true });
    for (let i = 0; i < 20; i++) await warmGalleryAtPublish(e, d, G);
    expect(calls.length).toBeLessThanOrEqual(OPEN_WARM_RATE.max);
  });

  it("a failing cover stops the run (Drive is unhappy) instead of going on to the grid", async () => {
    const { d, calls } = drive({ fail: true });
    await warmGalleryAtPublish(e, d, G);
    expect(calls).toHaveLength(1);
  });

  it("unpublishing mid-warm stops further Drive fetches", async () => {
    const { d, calls } = drive({
      onCall: async (n) => {
        if (n === 1)
          await db
            .update(schema.galleries)
            .set({ status: "draft" })
            .where(eq(schema.galleries.id, G));
      },
    });
    await warmGalleryAtPublish(e, d, G);
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("indicator reflects photos the publish warm already put in R2", async () => {
    const { d } = drive();
    await warmGalleryAtPublish(e, d, G);
    expect((await env.CACHE.head("a0/thumb")) !== null).toBe(true);
    const p = await warmProgress(e, G);
    expect(p.warmed).toBeGreaterThan(0);
  });
});
