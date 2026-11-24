import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../../db";
import { validTimezone } from "../../studio-time";
import { groupIssues, ISSUE_LABELS, utcIsoToLocal } from "../../admin-gallery";
import { adminImageToken } from "../images";
import { warmProgress } from "../warm";
import { hasWmSql, focusOf, resolveCover } from "../cover";
import { isDeleting } from "../gallery-delete";
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

export async function loadGalleryEdit(env: Env, id: string) {
  const db = getDb(env);
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  if (!g) return null;
  const clients = await listClientChoices(env, g.clientId);
  const ps = await db
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
      driveWebId: schema.photos.driveWebId,
      driveIgId: schema.photos.driveIgId,
      driveThumbId: schema.photos.driveThumbId,
      driveWmId: schema.photos.driveWmId,
      driveThumbWmId: schema.photos.driveThumbWmId,
      variantVersions: schema.photos.variantVersions,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
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
  // Proofing serves only preview-wm: photos without it 404 for clients.
  const noWm = ps.filter((p) => !p.hasWm);
  const issues = groupIssues(g.syncIssuesJson);
  const cover = resolveCover(
    ps.map((p) => ({ id: p.id, hasWm: !!p.hasWm })),
    g,
  );
  if (g.mode === "proofing" && noWm.length > 0) {
    issues.groups.push({
      type: "missing_wm",
      label: ISSUE_LABELS.missing_wm,
      items: noWm.map((p) => ({ set: p.set, name: p.name })),
    });
    issues.total += noWm.length;
  }
  return {
    gallery: {
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
      coverPhotoId: cover.editCover,
      coverFocus: focusOf(g.coverFocusX, g.coverFocusY),
      // Optional mobile cover: only while that photo is visible.
      coverPhotoIdMobile: cover.mobile,
      ...(cover.mobileNoWm ? { mobileCoverNoWm: true as const } : {}),
      coverFocusMobile: cover.mobile
        ? focusOf(g.coverFocusMobileX, g.coverFocusMobileY)
        : null,
    },
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
    issues,
  };
}
