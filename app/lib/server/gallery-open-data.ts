/** The client payload of an open gallery (cover, design, sets, photos, link-preview data). */
import { and, asc, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type { GalleryPhoto, OpenGallery } from "../../components/types";
import { isPinned } from "./access";
import { focusOf, resolveCover } from "./cover";
import { imageVersionToken } from "./images";

type GalleryRow = typeof schema.galleries.$inferSelect & {
  /** The client's PIN hash when known (T6.52); the admin preview has none. */
  clientPinHash?: string | null;
};

export const OG_LONG_EDGE = 1200;

async function versionField(
  env: Env,
  photo: typeof schema.photos.$inferSelect,
  wm: boolean,
): Promise<{ v?: string }> {
  const v = await imageVersionToken(env, photo, wm);
  return v ? { v } : {};
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
  const full = await getDb(env)
    .select()
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  const rows: Row[] = full.map((p) => ({
    id: p.id,
    width: p.width,
    height: p.height,
    set: p.setName,
    driveWebId: p.driveWebId,
    driveIgId: p.driveIgId,
    driveWmId: p.driveWmId,
  }));
  return { full, rows };
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
  const { full, rows } = await loadOpenRows(env, g);
  // In proofing, crawlers only get /view-sm of a photo that has a
  // preview-wm; otherwise the og:image URL would 404.
  const proofing = g.mode === "proofing";
  const cover = resolveCover(
    rows.map((p) => ({ id: p.id, hasWm: !!p.driveWmId })),
    g,
  );
  const ogCover = proofing
    ? rows.find((p) => p.id === cover.cover && p.driveWmId) ||
      rows.find((p) => p.driveWmId)
    : rows.find((p) => p.id === cover.cover);

  return {
    gallery: openGallery(g, rows, cover, proofing),
    photos: await Promise.all(
      rows.map(async ({ driveWebId, driveIgId, driveWmId: _wm, ...p }, i) => ({
        ...p,
        variants: { web: !!driveWebId, ig: !!driveIgId },
        // Opaque cache-busting token for the image URLs (never a Drive id).
        ...(await versionField(env, full[i], proofing)),
      })),
    ),
    og: ogOf(g, ogCover),
  };
}
