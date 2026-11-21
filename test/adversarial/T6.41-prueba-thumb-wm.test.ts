import { clearCache } from "../support/cache";
import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { serveImage } from "../../app/lib/server/images";

const db = getDb(env);
const G = "aaaaaaaa-0000-4000-8000-0000000t6410";
const P = [
  "pppppppp-0000-4000-8000-0000000t6411",
  "pppppppp-0000-4000-8000-0000000t6412",
];

beforeAll(async () => {
  await migrateDb();
  await clearCache();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "prueba-t641",
    title: "T",
    status: "published",
    mode: "proofing",
  });
  await db.insert(schema.photos).values([
    // full set
    {
      id: P[0],
      galleryId: G,
      baseName: "A",
      driveHighresId: "HI",
      driveWebId: "WEB",
      driveThumbId: "TH",
      driveWmId: "WM",
      driveThumbWmId: "TWM",
      variantVersions: JSON.stringify({
        wm: "w",
        thumbWm: "t",
        web: "x",
        thumb: "y",
        highres: "z",
      }),
      width: 3,
      height: 2,
      sort: 0,
    },
    // no thumb-wm
    {
      id: P[1],
      galleryId: G,
      baseName: "B",
      driveHighresId: "HI2",
      driveWebId: "WEB2",
      driveThumbId: "TH2",
      driveWmId: "WM2",
      variantVersions: JSON.stringify({ wm: "w" }),
      width: 3,
      height: 2,
      sort: 1,
    },
  ]);
});

describe("T6.41 Prueba: no variant ever fetches a clean file", () => {
  for (const [i, wm] of [
    [0, ["TWM", "WM"]],
    [1, ["WM2"]],
  ] as const) {
    for (const variant of ["thumb", "view-sm", "view-lg"]) {
      it(`photo ${i} ${variant}`, async () => {
        await clearCache();
        const fetched: string[] = [];
        const drive = {
          async streamFile(id: string) {
            fetched.push(id);
            return new Response("x", {
              headers: { "Content-Type": "image/jpeg", "Content-Length": "1" },
            });
          },
        } as unknown as DriveClient;
        const res = await serveImage(
          new Request(`https://x.test/img/${P[i]}/${variant}?v=1`),
          { photoId: P[i], variant },
          { ...env, DRIVE_MODE: "google" } as Env,
          { waitUntil() {} },
          { drive },
        );
        await res.arrayBuffer();
        for (const f of fetched) expect(wm).toContain(f);
      });
    }
  }
});
