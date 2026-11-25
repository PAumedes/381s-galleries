import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import {
  warmGalleryOnOpen,
  warmGalleryPending,
} from "../../app/lib/server/gallery-warm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const G = "gggggggg-0000-0000-0000-0000000000e1";
const SLUG = "s-guards";
const V = "2026-01-01T00:00:01Z";

function fakeDrive(gate?: Promise<void>) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += 1;
      if (gate) await gate;
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

async function seed(status: "published" | "draft") {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: SLUG,
    title: "T",
    status,
  });
  for (let i = 0; i < 3; i++)
    await db.insert(schema.photos).values({
      id: `e${i}`,
      galleryId: G,
      baseName: `e${i}`,
      driveHighresId: `HI${i}`,
      driveWebId: `WEB${i}`,
      driveThumbId: `TH${i}`,
      driveWmId: `WM${i}`,
      variantVersions: JSON.stringify({ highres: V, web: V, thumb: V, wm: V }),
      width: 3,
      height: 2,
    });
}

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.47 warm guards (survived mutations)", () => {
  it("one warm run at a time per gallery: a concurrent open is skipped 'running'", async () => {
    await seed("published");
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const a = warmGalleryOnOpen(e, fakeDrive(gate).drive, SLUG);
    await new Promise((r) => setTimeout(r, 50));
    const second = fakeDrive();
    const b = await warmGalleryOnOpen(e, second.drive, SLUG);
    open();
    await a;
    expect(b.skipped).toBe("running");
    expect(second.calls).toHaveLength(0);
  });

  it("walkGrid re-checks availability before reading a page (stale row passed by the caller)", async () => {
    await seed("published");
    const [stale] = await db.select().from(schema.galleries); // published copy
    await db
      .update(schema.galleries)
      .set({ status: "draft" })
      .where(eq(schema.galleries.id, G));
    const { drive, calls } = fakeDrive();
    const r = await warmGalleryPending(e, drive, stale, {
      start: 0,
      budget: 36,
    });
    expect(calls).toHaveLength(0);
    expect(r.stopped).toBe("error");
  });
});
