import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../../db";
import { validTimezone } from "../../studio-time";
import { groupIssues, ISSUE_LABELS, utcIsoToLocal } from "../../admin-gallery";
import { adminImageToken } from "../images";
import { warmProgress } from "../warm";
import { hasWmSql, focusOf, resolveCover } from "../cover";
import { hasPreview } from "../tiff";
import { isDeleting } from "../gallery-delete";
import { atLatestVersion, loadGalleryVersions } from "../photo-versions";
import { listClientChoices } from "./client-choices";

/** Hash of the visible photo ids (order independent): changes when the photo set changes. */
export async function photoSetVersion(ids: readonly string[]): Promise<string> {
  const data = new TextEncoder().encode([...ids].sort().join("\n"));
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(d.slice(0, 12), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export interface EditPhoto {
  id: string;
  set: string;
  name: string;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  /**
   * Opaque token of the photo's current admin image files (`?v=` on
   * `/admin/img` URLs, which makes them privately cacheable); null = unknown.
   */
  v?: string | null;
  /** Has a preview-wm (what Prueba serves); no ids. Absent = unknown. */
  hasWm?: boolean;
}

type GalleryRow = typeof schema.galleries.$inferSelect;

/** The visible photos with everything the editor derives from them (flags, image token inputs). */
function editPhotoRows(db: ReturnType<typeof getDb>, galleryId: string) {
  return db
    .select({
      id: schema.photos.id,
      set: schema.photos.setName,
      name: schema.photos.baseName,
      takenAt: schema.photos.takenAt,
      width: schema.photos.width,
      height: schema.photos.height,
      hasWm: hasWmSql("photos.drive_wm_id"),
      hasThumbWm: sql<number>`(${schema.photos.driveThumbWmId} IS NOT NULL)`,
      driveHighresId: schema.photos.driveHighresId,
      driveTiffId: schema.photos.driveTiffId,
      driveWebId: schema.photos.driveWebId,
      driveIgId: schema.photos.driveIgId,
      driveThumbId: schema.photos.driveThumbId,
      driveWmId: schema.photos.driveWmId,
      driveThumbWmId: schema.photos.driveThumbWmId,
      variantVersions: schema.photos.variantVersions,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, galleryId), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
}

type EditRow = Awaited<ReturnType<typeof editPhotoRows>>[number];

/**
 * A versioned album shows each photo at its latest version a visitor can be
 * shown (T6.53c), so the editor reads the same columns: one more query, only
 * for such albums. `fellBack` = the photos shown at an older version because
 * the newest has no preview-wm (Prueba).
 */
async function atShownVersions(env: Env, g: GalleryRow, rows: EditRow[]) {
  if (!g.versioning) return { rows, fellBack: [] };
  const live = await loadGalleryVersions(env, g.id);
  const proofing = g.mode === "proofing";
  const fellBack: EditRow[] = [];
  const shown = rows.map((p) => {
    const at = atLatestVersion(p, live.get(p.id), proofing);
    const row = {
      ...at,
      hasWm: Number(!!at.driveWmId),
      hasThumbWm: Number(!!at.driveThumbWmId),
    };
    const newest = live.get(p.id)?.at(-1);
    if (proofing && at.driveWmId && newest && !newest.driveWmId)
      fellBack.push(row);
    return row;
  });
  return { rows: shown, fellBack };
}

type Named = { set: string; name: string };

/**
 * Sync issues, plus (proofing only) the photos without preview-wm, which 404
 * for clients, and (any mode) the TIFF-only photos with no image to show.
 */
function editIssues(
  g: GalleryRow,
  noWm: Named[],
  fellBack: Named[],
  noPreview: Named[],
  photoCount: number,
) {
  const issues = groupIssues(g.syncIssuesJson);
  const extra = (
    type:
      | "missing_wm"
      | "version_wm_fallback"
      | "tiff_no_preview"
      | "tiff_album_unlisted",
    list: Named[],
    onlyProofing = true,
  ) => {
    if ((onlyProofing && g.mode !== "proofing") || list.length === 0) return;
    issues.groups.push({
      type,
      label: ISSUE_LABELS[type],
      items: list.map((p) => ({ set: p.set || null, name: p.name })),
    });
    issues.total += list.length;
  };
  extra("missing_wm", noWm);
  extra("version_wm_fallback", fellBack);
  extra("tiff_no_preview", noPreview, false);
  // Every photo is TIFF-only without a preview: no cover, so the album is left
  // off the studio home; the client page lists it title-only (T6.53d2).
  if (noPreview.length > 0 && noPreview.length === photoCount)
    extra("tiff_album_unlisted", [{ set: "", name: g.title }], false);
  return issues;
}

/** The gallery fields the editor shows (never ids of Drive files). */
function editGallery(
  env: Env,
  g: GalleryRow,
  clients: Awaited<ReturnType<typeof listClientChoices>>,
  cover: ReturnType<typeof resolveCover>,
) {
  return {
    id: g.id,
    title: g.title,
    slug: g.slug,
    clientId: g.clientId,
    clientSlug: clients.find((c) => c.id === g.clientId)?.slug ?? null,
    eventDate: g.eventDate,
    expires: utcIsoToLocal(g.expiresAt, validTimezone(env.TIMEZONE)),
    status: g.status,
    allowHighres: g.allowHighres,
    allowWeb: g.allowWeb,
    allowIg: g.allowIg,
    allowBulk: g.allowBulk,
    requireEmail: g.requireEmail,
    mode: g.mode,
    palette: g.palette,
    coverLayout: g.coverLayout,
    gridStyle: g.gridStyle,
    gridGap: g.gridGap,
    hasPin: g.pinHash !== null,
    showOnHome: g.showOnHome,
    versioning: g.versioning,
    coverPhotoId: cover.editCover,
    coverFocus: focusOf(g.coverFocusX, g.coverFocusY),
    // Optional mobile cover: only while that photo is visible.
    coverPhotoIdMobile: cover.mobile,
    ...(cover.mobileNoWm ? { mobileCoverNoWm: true as const } : {}),
    coverFocusMobile: cover.mobile
      ? focusOf(g.coverFocusMobileX, g.coverFocusMobileY)
      : null,
  };
}

export async function loadGalleryEdit(env: Env, id: string) {
  const db = getDb(env);
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  if (!g) return null;
  const clients = await listClientChoices(env, g.clientId);
  const { rows: ps, fellBack } = await atShownVersions(
    env,
    g,
    await editPhotoRows(db, id),
  );
  const photos: EditPhoto[] = await Promise.all(
    ps.map(async (p) => ({
      id: p.id,
      set: p.set,
      name: p.name,
      takenAt: p.takenAt,
      width: p.width,
      height: p.height,
      v: await adminImageToken(env, p),
      hasWm: !!p.hasWm,
    })),
  );
  const noWm = ps.filter((p) => !p.hasWm);
  const noPreview = ps.filter((p) => !hasPreview(p, g.mode === "proofing"));
  const cover = resolveCover(
    ps.map((p) => ({
      id: p.id,
      hasWm: !!p.hasWm,
      hasPreview: hasPreview(p, g.mode === "proofing"),
    })),
    g,
  );
  return {
    gallery: editGallery(env, g, clients, cover),
    /** Client folders for the album select (T6.40c): id, name, public slug. */
    clients,
    /** Deletion started but not finished: the editor only offers to continue it. */
    deleting: await isDeleting(env, g.driveFolderId),
    /** Photos ready (R2 warm marker current) / visible; null in mock mode (nothing to warm). */
    cacheProgress:
      env.DRIVE_MODE === "mock" ? null : await warmProgress(env, g.id),
    /** Counts only (never ids): visible photos, and those with a preview-wm. */
    photoCount: ps.length,
    wmCount: ps.length - noWm.length,
    hasWmFiles: ps.some((p) => p.hasWm),
    hasThumbWmFiles: ps.some((p) => p.hasThumbWm),
    photos,
    version: await photoSetVersion(photos.map((p) => p.id)),
    issues: editIssues(g, noWm, fellBack, noPreview, ps.length),
  };
}
