/** The client payload of an open gallery (cover, design, sets, photos, link-preview data). */
import { and, asc, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type {
  GalleryPhoto,
  OpenGallery,
  PhotoVersionInfo,
} from "../../components/types";
import { isPinned } from "./access";
import { focusOf, resolveCover } from "./cover";
import { imageVersionToken } from "./images";
import { hasPreview, hasTiffOriginal, tiffFilename } from "./tiff";
import type { SourcePhoto } from "./image-source";
import {
  atLatestVersion,
  atVersion,
  chooseVersion,
  loadGalleryVersions,
  servable,
  trusted,
  type VersionRow,
} from "./photo-versions";

type GalleryRow = typeof schema.galleries.$inferSelect & {
  /** The client's PIN hash when known (T6.52); the admin preview has none. */
  clientPinHash?: string | null;
};

export const OG_LONG_EDGE = 1200;

async function versionField(
  env: Env,
  photo: SourcePhoto,
  wm: boolean,
): Promise<{ v?: string }> {
  const v = await imageVersionToken(env, photo, wm);
  return v ? { v } : {};
}

type Photo = typeof schema.photos.$inferSelect;

/** What a photo of a versioned album adds to its payload (nothing for a photo with a single version). */
interface VersionView {
  ver?: number;
  versions?: PhotoVersionInfo[];
  /** Round number of the version shown (badge and header are decided across photos). */
  round: number | null;
}

async function versionView(
  env: Env,
  photo: Photo,
  live: readonly VersionRow[],
  proofing: boolean,
): Promise<VersionView> {
  const shown = chooseVersion(live, proofing);
  const visible = live.filter((r) => servable(r, proofing));
  // A version with no image (TIFF-only, no web JPEG / preview-wm) has nothing
  // to preview: the history does not list it (T6.53d).
  const listed = visible.filter((r) =>
    hasPreview(atVersion(photo, r), proofing),
  );
  if (!shown || (shown.version < 2 && visible.length < 2))
    return { round: null };
  const history =
    visible.length >= 2
      ? await Promise.all(
          listed.map(async (r) => ({
            n: r.version,
            round: r.roundNumber,
            at: r.firstSeenAt,
            ...(await versionField(env, atVersion(photo, r), proofing)),
          })),
        )
      : undefined;
  return {
    ver: shown.version,
    ...(history && { versions: history }),
    round: shown.roundNumber,
  };
}

export interface OpenData {
  gallery: OpenGallery;
  photos: GalleryPhoto[];
  /**
   * Link-preview data (Open Graph). null for PIN galleries: crawlers get
   * generic meta only. For public ones, `coverId` is the visible cover
   * (null when there are no photos); width/height = its aspect at a
   * 1200px long edge (null when unknown).
   */
  og: {
    coverId: string | null;
    width: number | null;
    height: number | null;
  } | null;
}

type Row = {
  id: string;
  width: number | null;
  height: number | null;
  set: string;
  driveWebId: string | null;
  driveIgId: string | null;
  driveWmId: string | null;
  /** No image can be shown (TIFF-only without a preview): placeholder card, never a cover. */
  noPreview: boolean;
};

/** Consecutive runs of the same set, in grid order. */
function setsOf(rows: Row[]): { name: string; count: number }[] {
  const sets: { name: string; count: number }[] = [];
  for (const p of rows) {
    const last = sets[sets.length - 1];
    if (last?.name === p.set) last.count++;
    else sets.push({ name: p.set, count: 1 });
  }
  return sets;
}

/** Open Graph data: null for PIN galleries (own or client PIN); else the cover scaled to a 1200px long edge. */
function ogOf(g: GalleryRow, ogCover: Row | undefined): OpenData["og"] {
  if (isPinned(g)) return null;
  const long = Math.max(ogCover?.width ?? 0, ogCover?.height ?? 0);
  const scale = long > 0 ? OG_LONG_EDGE / long : 0;
  return {
    coverId: ogCover?.id ?? null,
    width: scale && ogCover?.width ? Math.round(ogCover.width * scale) : null,
    height:
      scale && ogCover?.height ? Math.round(ogCover.height * scale) : null,
  };
}

/** Visible photos in gallery order, trimmed to what the open-data payload needs. */
async function loadOpenRows(env: Env, g: GalleryRow) {
  const stored = await getDb(env)
    .select()
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  // Versioned albums (and only those) show each photo at its latest version.
  const live = g.versioning ? await loadGalleryVersions(env, g.id) : undefined;
  const proofing = g.mode === "proofing";
  const full = live
    ? stored.map((p) => atLatestVersion(p, live.get(p.id), proofing))
    : stored;
  const rows: Row[] = full.map((p) => ({
    id: p.id,
    width: p.width,
    height: p.height,
    set: p.setName,
    driveWebId: p.driveWebId,
    driveIgId: p.driveIgId,
    driveWmId: p.driveWmId,
    noPreview: !hasPreview(p, proofing),
  }));
  return { stored, full, rows, live };
}

/** What a photo with a TIFF original adds to its payload: name and size for the placeholder card, never an id. */
function tiffFields(
  photo: Pick<Photo, "baseName" | "driveTiffId" | "highresBytes">,
  noPreview: boolean,
  proofing: boolean,
): Pick<GalleryPhoto, "tiff" | "noPreview"> {
  // Prueba never advertises an original, except on the placeholder card itself.
  if (!hasTiffOriginal(photo) || (proofing && !noPreview)) return {};
  return {
    tiff: { name: tiffFilename(photo.baseName), bytes: photo.highresBytes },
    ...(noPreview && { noPreview: true as const }),
  };
}

/** The newest round among the versions shown (the album header's "Ronda N"); undefined when none has one. */
function newestRound(views: readonly VersionView[]): number | undefined {
  const rounds = views.flatMap((v) =>
    v.ver && v.round !== null ? [v.round] : [],
  );
  return rounds.length ? Math.max(...rounds) : undefined;
}

/** The payload fields of one photo's versions; `isNew` when its version came with the newest round. */
function versionFields(view: VersionView, newest: number | undefined) {
  const { ver, versions, round } = view;
  return {
    ...(ver && { ver }),
    ...(versions && { versions }),
    ...(ver && round !== null && round === newest && { isNew: true as const }),
  };
}

/** Gallery fields of the payload. Proofing: no downloads at all (the server refuses them too). */
function openGallery(
  g: GalleryRow,
  rows: Row[],
  cover: { cover: string | null; mobile: string | null },
  proofing: boolean,
): OpenData["gallery"] {
  const { cover: coverId, mobile } = cover;
  return {
    slug: g.slug,
    requireEmail: g.requireEmail,
    title: g.title,
    eventDate: g.eventDate,
    coverPhotoId: coverId,
    coverFocus: focusOf(g.coverFocusX, g.coverFocusY),
    coverPhotoIdMobile: mobile,
    coverFocusMobile: mobile
      ? focusOf(g.coverFocusMobileX, g.coverFocusMobileY)
      : null,
    mode: g.mode,
    allowBulk: !proofing && g.allowBulk,
    allowHighres: !proofing && g.allowHighres,
    allowWeb: !proofing && g.allowWeb,
    allowIg: !proofing && g.allowIg,
    palette: g.palette,
    coverLayout: g.coverLayout,
    gridStyle: g.gridStyle,
    gridGap: g.gridGap,
    sets: setsOf(rows),
  };
}

/**
 * The client payload of an open gallery (cover, design, sets, photos with
 * their `?v=` tokens, link-preview data). No access checks and no side
 * effects: callers decide who may see it (`loadGallery` for visitors, the
 * admin preview for the owner). Never carries Drive ids, the client name or
 * PIN data.
 */
export async function buildOpenData(
  env: Env,
  g: GalleryRow,
): Promise<OpenData> {
  const { stored, full, rows, live } = await loadOpenRows(env, g);
  // In proofing, crawlers only get /view-sm of a photo that has a
  // preview-wm; otherwise the og:image URL would 404.
  const proofing = g.mode === "proofing";
  const cover = resolveCover(
    rows.map((p) => ({
      id: p.id,
      hasWm: !!p.driveWmId,
      hasPreview: !p.noPreview,
    })),
    g,
  );
  const ogCover = proofing
    ? rows.find((p) => p.id === cover.cover && p.driveWmId) ||
      rows.find((p) => p.driveWmId)
    : rows.find((p) => p.id === cover.cover);
  const views = live
    ? await Promise.all(
        stored.map((p) =>
          versionView(env, p, trusted(p, live.get(p.id)), proofing),
        ),
      )
    : undefined;
  const round = views && newestRound(views);

  return {
    gallery: {
      ...openGallery(g, rows, cover, proofing),
      ...(round !== undefined && { round }),
    },
    photos: await Promise.all(
      rows.map(
        async (
          { driveWebId, driveIgId, driveWmId: _wm, noPreview, ...p },
          i,
        ) => ({
          ...p,
          variants: { web: !!driveWebId, ig: !!driveIgId },
          ...(noPreview && { width: null, height: null }),
          ...tiffFields(full[i], noPreview, proofing),
          // Opaque cache-busting token for the image URLs (never a Drive id).
          ...(await versionField(env, full[i], proofing)),
          ...(views && versionFields(views[i], round)),
        }),
      ),
    ),
    og: ogOf(g, ogCover),
  };
}
