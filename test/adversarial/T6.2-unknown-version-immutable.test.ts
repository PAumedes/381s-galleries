import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { imageVersionToken, serveImage } from "../../app/lib/server/images";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);

beforeAll(async () => {
  await migrateDb();
});

it("a photo with unknown Drive modifiedTime must not get a 1-year immutable header (token cannot change when the file does)", async () => {
  await db.insert(schema.galleries).values({
    id: "g-uv",
    driveFolderId: "f",
    slug: "uv",
    title: "T",
    status: "published",
  });
  await db.insert(schema.photos).values({
    id: "p-uv",
    galleryId: "g-uv",
    baseName: "p",
    driveHighresId: "HI",
    driveWebId: "WEB",
    driveThumbId: "TH",
    variantVersions: null,
  });
  const [p] = await db.select().from(schema.photos);
  const v = await imageVersionToken(e, p, false);
  const drive = {
    async streamFile() {
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  const res = await serveImage(
    new Request(`https://x.test/img/p-uv/view-sm?v=${v}`),
    { photoId: "p-uv", variant: "view-sm" },
    e,
    { waitUntil() {} },
    { drive },
  );
  expect(res.headers.get("Cache-Control")).not.toContain("immutable");
});
