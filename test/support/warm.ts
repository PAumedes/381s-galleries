/** Shared fixtures for the warm tests: a fake Drive, gallery/photo seeds, a D1 query counter. */
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../app/db";
import { meterD1 } from "../../app/lib/server/d1-meter";
import { DriveError } from "../../app/lib/server/drive-types";
import type { DriveClient } from "../../app/lib/server/drive-types";

export const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
/** Gallery id number `n` (1..9 and beyond keep the last 3 chars distinct per n). */
export const warmGalleryId = (n: number, prefix = "a") =>
  `gggggggg-0000-0000-0000-0000000000${prefix}${n}`;
/** Id of photo `i` of a gallery; the file ids derive from it (`HI-`, `WEB-`, `TH-`, `WM-`, `TWM-`). */
export const photoId = (galleryId: string, i: number) =>
  `${galleryId.slice(-3)}p${String(i).padStart(3, "0")}`;

export const variantVersions = (n = "1") =>
  JSON.stringify(
    Object.fromEntries(
      ["highres", "web", "thumb", "wm", "thumbWm"].map((k) => [
        k,
        `2026-01-01T00:00:0${n}Z`,
      ]),
    ),
  );

export async function seedGallery(
  id: string,
  over: Record<string, unknown> = {},
) {
  await getDb(env)
    .insert(schema.galleries)
    .values({
      id,
      driveFolderId: "folder-" + id,
      slug: "s-" + id.slice(-3),
      title: "T",
      status: "published",
      ...over,
    });
}

export async function seedPhotos(galleryId: string, n: number, withWm = true) {
  for (let i = 0; i < n; i++) {
    const id = photoId(galleryId, i);
    await getDb(env)
      .insert(schema.photos)
      .values({
        id,
        galleryId,
        baseName: id,
        driveHighresId: `HI-${id}`,
        driveWebId: `WEB-${id}`,
        driveThumbId: `TH-${id}`,
        driveWmId: withWm ? `WM-${id}` : null,
        driveThumbWmId: withWm ? `TWM-${id}` : null,
        variantVersions: variantVersions(),
        width: 300,
        height: 200,
      });
  }
}

/** A Drive that serves a tiny JPEG for every file; `hook` runs per call, `fail` makes files 404. */
export function fakeWarmDrive(
  opts: {
    hook?: (id: string) => Promise<void> | void;
    fail?: (id: string) => boolean;
  } = {},
) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs++;
      await opts.hook?.(id);
      if (opts.fail?.(id)) throw new DriveError(404, "x", "d " + id);
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

/** `base` with a D1 that counts every prepared statement (one D1 query each). */
export function countingEnv(base: Env) {
  const m = meterD1(base);
  return { e: m.env, count: m.used };
}
