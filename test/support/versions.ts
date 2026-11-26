/** Seeds for the photo-version readers (T6.53c): a versioned photo with its rounds and version rows. */
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../app/db";

export interface SeedVersion {
  n: number;
  /** Round number it belongs to (default: n for n >= 2, none for v1). */
  round?: number | null;
  /** Has a preview-wm (default true). */
  wm?: boolean;
  /** The file left Drive: `missingSince` in drive_versions. */
  missing?: boolean;
  /** first_seen_at (default 2026-02-0<n>T10:00:00.000Z). */
  at?: string;
  width?: number;
  height?: number;
}

/** Drive file ids of version `n` of photo `tag`; never allowed in a client payload. */
export const files = (tag: string, n: number, wm = true) => ({
  driveHighresId: `HI-${tag}-v${n}`,
  driveWebId: `WEB-${tag}-v${n}`,
  driveThumbId: `TH-${tag}-v${n}`,
  driveWmId: wm ? `WM-${tag}-v${n}` : null,
  driveThumbWmId: wm ? `TWM-${tag}-v${n}` : null,
});

/** Modified times of version `n` (each one differs per version). */
export const modified = (n: number, missingSince?: string) =>
  JSON.stringify({
    highres: `2026-03-0${n}T00:00:01Z`,
    web: `2026-03-0${n}T00:00:02Z`,
    thumb: `2026-03-0${n}T00:00:03Z`,
    wm: `2026-03-0${n}T00:00:04Z`,
    thumbWm: `2026-03-0${n}T00:00:05Z`,
    ...(missingSince ? { missingSince } : {}),
  });

async function ensureRound(galleryId: string, number: number) {
  const db = getDb(env);
  const id = `round-${galleryId.slice(-3)}-${number}`;
  const [have] = await db
    .select()
    .from(schema.deliveryRounds)
    .where(
      and(
        eq(schema.deliveryRounds.galleryId, galleryId),
        eq(schema.deliveryRounds.number, number),
      ),
    );
  if (!have)
    await db
      .insert(schema.deliveryRounds)
      .values({ id, galleryId, number, startedAt: "2026-03-01T00:00:00.000Z" });
  return have?.id ?? id;
}

/**
 * One logical photo (`photos` mirrors the highest present version, like the
 * sync does) plus a `photo_versions` row per entry of `versions`.
 */
export async function seedVersioned(
  galleryId: string,
  photoId: string,
  versions: SeedVersion[],
  opts: { sort?: number } = {},
) {
  const db = getDb(env);
  const present = versions.filter((v) => !v.missing);
  const latest = present.reduce((a, b) => (b.n > a.n ? b : a));
  await db.insert(schema.photos).values({
    id: photoId,
    galleryId,
    baseName: photoId,
    sort: opts.sort ?? 0,
    ...files(photoId, latest.n, latest.wm ?? true),
    variantVersions: modified(latest.n),
    width: latest.width ?? 3000,
    height: latest.height ?? 2000,
  });
  for (const v of versions) {
    const round = v.round === undefined ? (v.n >= 2 ? v.n : null) : v.round;
    await db.insert(schema.photoVersions).values({
      photoId,
      galleryId,
      version: v.n,
      roundId: round === null ? null : await ensureRound(galleryId, round),
      ...files(photoId, v.n, v.wm ?? true),
      driveVersions: modified(
        v.n,
        v.missing ? "2026-03-09T00:00:00.000Z" : undefined,
      ),
      width: v.width ?? 3000,
      height: v.height ?? 2000,
      firstSeenAt: v.at ?? `2026-02-0${v.n}T10:00:00.000Z`,
    });
  }
}
