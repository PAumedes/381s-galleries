import { clearCache } from "../support/cache";
import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { galleryAction } from "../../app/lib/server/admin-galleries";
import type { DriveClient } from "../../app/lib/server/drive-types";

const db = getDb(env);
const G = "cccccccc-0000-0000-0000-0000000000ad";
const mockAdmin = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await clearCache();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "adv-warm",
    title: "T",
    status: "draft",
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "p1",
    driveHighresId: "HI",
    driveWebId: "WEB",
    driveThumbId: "TH",
    driveWmId: "WM",
    driveThumbWmId: "TWM",
    variantVersions: JSON.stringify({
      highres: "t1",
      web: "t2",
      thumb: "t3",
      wm: "t4",
      thumbWm: "t5",
    }),
    width: 3,
    height: 2,
  });
});

function fakeDrive(cost: number, delayMs = 0) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += cost;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return new Response(JPEG.slice(), {
        headers: {
          "Content-Length": String(JPEG.length),
          "Content-Type": "image/jpeg",
        },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls, subs: () => subs };
}
const save = (drive: DriveClient, pending: Promise<unknown>[]) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${G}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "cover", photoId: "p1" }),
    }),
    mockAdmin,
    G,
    {
      ctx: {
        waitUntil: (p: Promise<unknown>) => void pending.push(p),
      } as never,
      drive,
    },
  );

it("budget of 8 subrequests holds even when one Drive call costs 5 (OAuth refresh + 429 retries)", async () => {
  const f = fakeDrive(5);
  const pending: Promise<unknown>[] = [];
  await save(f.drive, pending);
  await Promise.all(pending);
  expect(f.subs()).toBeLessThanOrEqual(8);
});

it("two concurrent saves of the same cover fetch each Drive file once", async () => {
  const f = fakeDrive(1, 20);
  const pending: Promise<unknown>[] = [];
  await Promise.all([save(f.drive, pending), save(f.drive, pending)]);
  await Promise.all(pending);
  expect(f.calls.length).toBeLessThanOrEqual(3);
});
