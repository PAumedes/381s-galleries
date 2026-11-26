/**
 * Photo versions, shared helpers (T6.53b/c). `photo_versions.drive_versions`
 * is the same JSON as `photos.variant_versions` (each variant's Drive
 * modified time); a version whose file left Drive also carries `missingSince`
 * until the sync's grace period deletes the row. Readers must ignore such rows.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { D1_IN_CHUNK } from "./d1-limits";
import type { SourcePhoto } from "./image-source";

export const parseVersions = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(json ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const missingSinceOf = (json: string | null): string | null => {
  const v = parseVersions(json).missingSince;
  return typeof v === "string" ? v : null;
};

export const markMissing = (json: string | null, since: string) =>
  JSON.stringify({ ...parseVersions(json), missingSince: since });

/** Versions are 1..999 (the sync's range). */
const VERSION_PARAM = /^[1-9]\d{0,2}$/;

/** The `ver` query parameter of an image URL: absent (null), a version number, or malformed ("bad"). */
export function askedVersion(url: URL): number | null | "bad" {
  const raw = url.searchParams.get("ver");
  if (raw === null) return null;
  return VERSION_PARAM.test(raw) ? Number(raw) : "bad";
}

const PV = schema.photoVersions;
const R = schema.deliveryRounds;

const versionColumns = {
  photoId: PV.photoId,
  version: PV.version,
  roundNumber: R.number,
  firstSeenAt: PV.firstSeenAt,
  driveHighresId: PV.driveHighresId,
  driveWebId: PV.driveWebId,
  driveIgId: PV.driveIgId,
  driveThumbId: PV.driveThumbId,
  driveWmId: PV.driveWmId,
  driveThumbWmId: PV.driveThumbWmId,
  driveTiffId: PV.driveTiffId,
  highresBytes: PV.highresBytes,
  driveVersions: PV.driveVersions,
  width: PV.width,
  height: PV.height,
};

/** One version of a photo as the readers see it. Server-only: it holds Drive ids. */
export type VersionRow = Pick<
  typeof PV.$inferSelect,
  | "photoId"
  | "version"
  | "firstSeenAt"
  | "driveHighresId"
  | "driveWebId"
  | "driveIgId"
  | "driveThumbId"
  | "driveWmId"
  | "driveThumbWmId"
  | "driveTiffId"
  | "highresBytes"
  | "driveVersions"
  | "width"
  | "height"
> & { roundNumber: number | null };

/** The live (file still in Drive) rows per photo, versions ascending. */
function livePerPhoto(rows: VersionRow[]): Map<string, VersionRow[]> {
  const by = new Map<string, VersionRow[]>();
  for (const r of rows) {
    if (missingSinceOf(r.driveVersions) !== null) continue;
    by.set(r.photoId, [...(by.get(r.photoId) ?? []), r]);
  }
  for (const list of by.values()) list.sort((a, b) => a.version - b.version);
  return by;
}

/**
 * Every live version of every photo of a versioned gallery, with its round
 * number: ONE query (`VERSIONED_OPEN_D1_QUERIES`), through `photos` so the
 * lookup uses the (photo_id, version) key and the gallery index.
 */
export async function loadGalleryVersions(
  env: Env,
  galleryId: string,
): Promise<Map<string, VersionRow[]>> {
  const rows = await getDb(env)
    .select(versionColumns)
    .from(schema.photos)
    .innerJoin(
      PV,
      and(
        eq(PV.photoId, schema.photos.id),
        eq(PV.galleryId, schema.photos.galleryId),
      ),
    )
    .leftJoin(R, eq(R.id, PV.roundId))
    .where(eq(schema.photos.galleryId, galleryId));
  return livePerPhoto(rows);
}

/** The live versions of these photos (one query per `D1_IN_CHUNK` ids; none for an empty list). */
export async function loadVersionsOf(
  env: Env,
  photoIds: readonly string[],
): Promise<Map<string, VersionRow[]>> {
  const rows: VersionRow[] = [];
  for (let i = 0; i < photoIds.length; i += D1_IN_CHUNK)
    rows.push(
      ...(await getDb(env)
        .select(versionColumns)
        .from(PV)
        .leftJoin(R, eq(R.id, PV.roundId))
        .where(inArray(PV.photoId, photoIds.slice(i, i + D1_IN_CHUNK)))),
    );
  return livePerPhoto(rows);
}

/** Can a visitor be shown this version? Prueba needs its own preview-wm; Entrega always can. */
export const servable = (r: VersionRow, proofing: boolean): boolean =>
  !proofing || !!r.driveWmId;

/**
 * The version a gallery shows for a photo: the newest live one a visitor can
 * be shown (Prueba: with its own preview-wm), else the newest live one (the
 * photo then behaves as a photo without preview-wm, like before). undefined
 * when there are no live rows: the photo's own columns stand (v1).
 */
export function chooseVersion(
  live: readonly VersionRow[],
  proofing: boolean,
): VersionRow | undefined {
  return [...live].reverse().find((r) => servable(r, proofing)) ?? live.at(-1);
}

/**
 * The live versions of `photo` that can be trusted. Sync only writes
 * `photo_versions` for albums with versioning on, so a lone row left from the
 * unversioned era (the v1 backfill) goes stale while `photos` keeps being
 * updated; right after versioning is switched on and before the next sync
 * re-derives it, such a row that differs from the `photos` mirror loses.
 */
export function trusted<P extends SourcePhoto>(
  photo: P,
  live: readonly VersionRow[] | undefined,
): readonly VersionRow[] {
  if (!live || live.length !== 1) return live ?? [];
  const r = live[0];
  const same =
    r.driveHighresId === photo.driveHighresId &&
    r.driveWebId === photo.driveWebId &&
    r.driveIgId === photo.driveIgId &&
    r.driveThumbId === photo.driveThumbId &&
    r.driveWmId === photo.driveWmId &&
    (r.driveThumbWmId ?? null) === (photo.driveThumbWmId ?? null) &&
    r.driveTiffId === (photo.driveTiffId ?? null) &&
    r.driveVersions === photo.variantVersions;
  return same ? live : [];
}

/** `photo` with the columns of version `row` (files, modified times, size, version number). */
export function atVersion<P extends SourcePhoto>(
  photo: P,
  row: VersionRow,
): P & {
  version: number;
  width: number | null;
  height: number | null;
  highresBytes: number | null;
} {
  return {
    ...photo,
    driveHighresId: row.driveHighresId,
    driveWebId: row.driveWebId,
    driveIgId: row.driveIgId,
    driveThumbId: row.driveThumbId,
    driveWmId: row.driveWmId,
    driveThumbWmId: row.driveThumbWmId,
    driveTiffId: row.driveTiffId,
    highresBytes: row.highresBytes,
    variantVersions: row.driveVersions,
    width: row.width,
    height: row.height,
    version: row.version,
  };
}

/** `photo` at the version its gallery shows (see `chooseVersion`); unchanged without live rows. */
export function atLatestVersion<P extends SourcePhoto>(
  photo: P,
  live: readonly VersionRow[] | undefined,
  proofing: boolean,
): P {
  const row = chooseVersion(trusted(photo, live), proofing);
  return row ? atVersion(photo, row) : photo;
}

/**
 * `rows` of a gallery at their shown versions: no query at all unless the
 * gallery is versioned, then one per `D1_IN_CHUNK` photos.
 */
export async function latestOf<P extends SourcePhoto>(
  env: Env,
  gallery: { versioning: boolean; mode: string },
  rows: readonly P[],
): Promise<P[]> {
  if (!gallery.versioning || rows.length === 0) return [...rows];
  const live = await loadVersionsOf(
    env,
    rows.map((r) => r.id),
  );
  const proofing = gallery.mode === "proofing";
  return rows.map((r) => atLatestVersion(r, live.get(r.id), proofing));
}

/**
 * The photo as an image request sees it. An album with versioning off is the
 * `photos` row as before (and has no `ver`). A versioned one serves the
 * version asked with `?ver=N` (live rows only, so never one whose file left
 * Drive), else the version its gallery shows. null = 404.
 */
export async function servedPhoto<P extends SourcePhoto>(
  request: Request,
  env: Env,
  photo: P,
  gallery: { versioning: boolean; mode: string },
): Promise<P | null> {
  const asked = askedVersion(new URL(request.url));
  if (asked === "bad") return null;
  if (!gallery.versioning) return asked === null ? photo : null;
  const live = trusted(
    photo,
    (await loadVersionsOf(env, [photo.id])).get(photo.id),
  );
  if (asked === null)
    return atLatestVersion(photo, live, gallery.mode === "proofing");
  const row = live.find((r) => r.version === asked);
  return row ? atVersion(photo, row) : null;
}
