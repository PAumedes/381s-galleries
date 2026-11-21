import type { GalleryMode, GalleryStatus } from "../constants";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb, photoVisible, schema } from "../../db";
import type { Db } from "../../db";
import { resolveExpiry, validTimezone } from "../studio-time";
import {
  groupIssues,
  ISSUE_LABELS,
  isValidDate,
  normalizeSearch,
  utcIsoToLocal,
} from "../admin-gallery";
import type { Filter } from "../admin-gallery";
import { isCoverLayout, isGridGap, isGridStyle, isPalette } from "../design";
import { requestT } from "../../i18n/dictionaries";
import type { TFunction } from "../../i18n/t";
import { adminAction } from "./admin";
import type { DriveClient } from "./drive-types";
import { adminImageToken } from "./images";
import { scheduleWarmAtPublish } from "./gallery-warm";
import { warmCoverPhoto, warmProgress } from "./warm";
import {
  hasWmSql,
  listCoverIdSql,
  DEVICE_FIELDS,
  focusOf,
  resolveCover,
  type Device,
} from "./cover";
import { hashPin } from "./crypto";
import { deleteGallery, isDeleting } from "./gallery-delete";
import { RESERVED_SLUGS } from "./slug";
import { isExpired } from "./time";

type BatchItem = Parameters<Db["batch"]>[0][number];

/** Per id: 1 (WHEN) + 1 (IN) bound params, sort is an inlined integer; +1 gallery id = 91 < D1 limit 100. */
export const REORDER_CHUNK = 45;
const EXPIRY_YEAR_MIN = 2000;
const EXPIRY_YEAR_MAX = 2100;
export const TITLE_MAX = 120;
export const CLIENT_MAX = 120;
export const SLUG_MAX = 60;
export const PIN_MIN = 6;
export const PIN_MAX = 32;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Control chars and bidi overrides/isolates only (ZWJ/ZWNJ are legitimate).
const CONTROL_RE = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const ORDER_MAX_CHARS = 2_000_000;

const FILTER_STATUS: Record<Filter, "published" | "draft" | "archived" | null> =
  {
    todas: null,
    publicadas: "published",
    borradores: "draft",
    archivadas: "archived",
  };

// ------------------------------------------------------------------ list

/** A gallery whose deletion is in progress (tombstoned, row not gone yet): stays listed so it can be continued. */
const isDeletingSql = sql<boolean>`EXISTS (SELECT 1 FROM ignored_folders i WHERE i.drive_folder_id = ${schema.galleries.driveFolderId})`;

export interface GalleryListRow {
  id: string;
  title: string;
  slug: string;
  clientName: string | null;
  eventDate: string | null;
  status: GalleryStatus;
  /** Prueba (watermarked, no downloads) or Entrega. */
  mode: GalleryMode;
  expiresAt: string | null;
  expired: boolean;
  /** Chosen cover when visible, else the first visible photo, else null. */
  coverPhotoId: string | null;
  photoCount: number;
  views: number;
  /** Per-photo download rows only (bulk header rows are excluded). */
  downloads: number;
  issueCount: number;
  /** Deletion started but not finished: the list offers "Continuar eliminación". */
  deleting: boolean;
}

export async function listGalleries(
  env: Env,
  filter: Filter,
  q = "",
): Promise<GalleryListRow[]> {
  const g = schema.galleries;
  const status = FILTER_STATUS[filter];
  const rows = await getDb(env)
    .select({
      id: g.id,
      title: g.title,
      slug: g.slug,
      clientName: g.clientName,
      eventDate: g.eventDate,
      status: g.status,
      mode: g.mode,
      expiresAt: g.expiresAt,
      syncIssuesJson: g.syncIssuesJson,
      coverPhotoId: listCoverIdSql(),
      photoCount: sql<number>`(SELECT count(*) FROM photos p WHERE p.gallery_id = galleries.id AND p.missing_since IS NULL)`,
      deleting: sql<number>`${isDeletingSql}`,
      views: sql<number>`(SELECT count(*) FROM gallery_views v WHERE v.gallery_id = galleries.id)`,
      downloads: sql<number>`(SELECT count(*) FROM downloads d WHERE d.gallery_id = galleries.id AND d.photo_id IS NOT NULL)`,
    })
    .from(g)
    .where(status ? eq(g.status, status) : undefined)
    .orderBy(
      sql`${g.status} = 'archived'`,
      sql`${g.createdAt} DESC`,
      asc(g.title),
      asc(g.id),
    );
  const now = Date.now();
  // Search on the loaded rows (a studio has well under 1000 galleries):
  // accent/case-insensitive substring over title, slug and client name.
  const needle = normalizeSearch(q);
  const matched = needle
    ? rows.filter((r) =>
        [r.title, r.slug, r.clientName ?? ""].some((v) =>
          normalizeSearch(v).includes(needle),
        ),
      )
    : rows;
  return matched.map(({ syncIssuesJson, ...r }) => ({
    ...r,
    deleting: !!r.deleting,
    expired: isExpired(r.expiresAt, now),
    issueCount: groupIssues(syncIssuesJson).total,
  }));
}

/** Number of galleries per status (for the empty-state decision). */
export async function countGalleries(env: Env): Promise<number> {
  const [r] = await getDb(env)
    .select({ n: sql<number>`count(*)` })
    .from(schema.galleries);
  return r?.n ?? 0;
}

// ------------------------------------------------------------------ edit

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
      clientName: g.clientName,
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

// ---------------------------------------------------------------- actions

export interface GalleryActionResult {
  intent: string;
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Reorder only: the photo set changed since the page was loaded. */
  stale?: boolean;
  /** Delete only: the deletion is not finished yet; submit again. */
  continuing?: boolean;
}

const fail = (
  intent: string,
  error: string,
  fieldErrors?: Record<string, string>,
  extra: Partial<GalleryActionResult> = {},
): GalleryActionResult => ({
  intent,
  ok: false,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
  ...extra,
});
const done = (intent: string, message: string): GalleryActionResult => ({
  intent,
  ok: true,
  message,
});
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

/** Optional extras of a gallery action (the route injects them). */
export interface GalleryActionDeps {
  ctx?: Pick<ExecutionContext, "waitUntil">;
  /** Present = warm R2 after a cover save; the route passes none in mock mode. */
  drive?: DriveClient;
}

export async function galleryAction(
  request: Request,
  env: Env,
  id: string,
  deps?: GalleryActionDeps,
): Promise<GalleryActionResult> {
  await adminAction(request, env);
  const t = requestT(request);
  const db = getDb(env);
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  if (!g) throw new Response("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("", t("admin.msg.invalidRequest"));
  }
  const intent = str(form, "intent");
  if (intent === "delete") return deleteIntent(env, g, form, t);
  // A gallery being deleted accepts nothing else.
  if (await isDeleting(env, g.driveFolderId))
    return fail(intent, t("admin.msg.stale"));
  switch (intent) {
    case "details":
      return saveDetails(env, g, form, t);
    case "design":
      return saveDesign(env, g, form, t);
    case "flags":
      return saveFlags(env, g, form, t);
    case "home":
      return saveHome(env, g, form, t);
    case "status":
      return changeStatus(env, g, str(form, "to"), t, deps);
    case "pin":
      return savePin(env, g, form, t);
    case "cover":
      return saveCover(env, g, form, t, deps);
    case "focus":
      return saveFocus(env, g, form, t);
    case "reorder":
      return reorder(env, g, form, t);
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
}

type GalleryRow = typeof schema.galleries.$inferSelect;

/**
 * Danger zone: the admin must type the gallery slug (checked here, not in JS).
 * Success redirects to /admin; an unfinished deletion asks to be submitted again.
 */
async function deleteIntent(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
): Promise<GalleryActionResult> {
  const intent = "delete";
  if (str(f, "slug").trim().toLowerCase() !== g.slug.toLowerCase())
    return fail(intent, t("admin.msg.deleteSlugMismatch"));
  let outcome: Awaited<ReturnType<typeof deleteGallery>>;
  try {
    outcome = await deleteGallery(env, g.id);
  } catch {
    // R2 or D1 failed: the gallery stays marked (and listed as "deleting");
    // submitting again resumes, every step is repeatable.
    console.error("delete gallery failed");
    return fail(intent, t("admin.msg.deleteFailed"));
  }
  switch (outcome) {
    case "deleted":
      throw redirect("/admin?deleted=1", 303);
    case "continue":
      return fail(intent, t("admin.msg.deleteContinuing"), undefined, {
        continuing: true,
      });
    case "busy":
      return fail(intent, t("admin.msg.deleteBusy"));
    case "not_found":
      throw new Response("Not found", { status: 404 });
  }
}

async function saveDetails(env: Env, g: GalleryRow, f: FormData, t: TFunction) {
  const intent = "details";
  const errors: Record<string, string> = {};

  const title = str(f, "title").trim();
  if (title.length < 1 || title.length > TITLE_MAX || CONTROL_RE.test(title))
    errors.title = t("admin.msg.titleLength", { max: TITLE_MAX });

  const clientRaw = str(f, "clientName").trim();
  if (clientRaw.length > CLIENT_MAX || CONTROL_RE.test(clientRaw))
    errors.clientName = t("admin.msg.clientLength", { max: CLIENT_MAX });

  const slug = str(f, "slug").trim().toLowerCase();
  if (RESERVED_SLUGS.includes(slug)) errors.slug = t("admin.msg.slugReserved");
  else if (!slug || slug.length > SLUG_MAX || !SLUG_RE.test(slug))
    errors.slug = t("admin.msg.slugFormat", { max: SLUG_MAX });

  const eventDate = str(f, "eventDate").trim();
  if (eventDate && !isValidDate(eventDate))
    errors.eventDate = t("admin.msg.eventDateInvalid");

  const expDate = str(f, "expiresDate").trim();
  const expTime = str(f, "expiresTime").trim();
  let expiresAt: string | null = null;
  if (expDate || expTime) {
    const yr = Number(expDate.slice(0, 4));
    if (expDate && (yr < EXPIRY_YEAR_MIN || yr > EXPIRY_YEAR_MAX))
      errors.expires = t("admin.msg.expiryYear", {
        min: EXPIRY_YEAR_MIN,
        max: EXPIRY_YEAR_MAX,
      });
    else {
      // A date without a time means "until the end of that day" (studio time).
      expiresAt = expDate
        ? resolveExpiry(
            expDate,
            expTime || "23:59",
            g.expiresAt,
            validTimezone(env.TIMEZONE),
          )
        : null;
      if (!expiresAt)
        errors.expires = expDate
          ? t("admin.msg.expiryInvalid")
          : t("admin.msg.expiryNeedsDate");
    }
  }

  if (
    !errors.slug &&
    slug !== g.slug.toLowerCase() &&
    (await slugTaken(env, slug, g.id))
  )
    errors.slug = t("admin.msg.slugTaken");

  if (Object.keys(errors).length)
    return fail(intent, t("admin.msg.checkFields"), errors);

  try {
    await getDb(env)
      .update(schema.galleries)
      .set({
        title,
        slug,
        clientName: clientRaw || null,
        eventDate: eventDate || null,
        expiresAt,
        // An expired gallery stops qualifying: the opt-in does not survive.
        ...(isExpired(expiresAt, Date.now()) ? { showOnHome: false } : {}),
      })
      .where(eq(schema.galleries.id, g.id));
  } catch (err) {
    if (isConstraintError(err))
      return fail(intent, t("admin.msg.checkFields"), {
        slug: t("admin.msg.slugTaken"),
      });
    throw err;
  }
  return done(intent, t("admin.msg.detailsSaved"));
}

/** drizzle wraps driver errors ("Failed query"); the SQLite text is in err.cause. */
export function isConstraintError(err: unknown): boolean {
  for (let e = err, i = 0; e != null && i < 8; i++) {
    const m = String(e instanceof Error ? e.message : e);
    if (/UNIQUE|SQLITE_CONSTRAINT/i.test(m)) return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

async function slugTaken(env: Env, slug: string, selfId: string) {
  const rows = await getDb(env)
    .select({ id: schema.galleries.id })
    .from(schema.galleries)
    .where(sql`${schema.galleries.slug} = ${slug} COLLATE NOCASE`);
  return rows.some((r) => r.id !== selfId);
}

async function saveFlags(env: Env, g: GalleryRow, f: FormData, t: TFunction) {
  const intent = "flags";
  const on = (k: string) => f.get(k) === "1";
  const modeRaw = f.get("mode");
  if (modeRaw !== null && modeRaw !== "proofing" && modeRaw !== "delivery")
    return fail(intent, t("admin.msg.checkFields"), {
      mode: t("admin.msg.modeInvalid"),
    });
  const mode: GalleryMode = modeRaw ?? g.mode;
  await getDb(env)
    .update(schema.galleries)
    .set({
      // Prueba: the form disables the download boxes (not submitted), so keep
      // the stored values for when the gallery goes back to Entrega.
      ...(mode === "proofing"
        ? {}
        : {
            allowHighres: on("allowHighres"),
            allowWeb: on("allowWeb"),
            allowIg: on("allowIg"),
            allowBulk: on("allowBulk"),
          }),
      requireEmail: on("requireEmail"),
      mode,
    })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.optionsSaved"));
}

/**
 * "Mostrar en la portada" (T6.6). Only "1"/"0". Enabling needs a published
 * gallery without PIN (the home query enforces the same, this keeps the stored
 * flag honest); disabling always works.
 */
async function saveHome(env: Env, g: GalleryRow, f: FormData, t: TFunction) {
  const intent = "home";
  const raw = f.get("showOnHome");
  if (raw !== "1" && raw !== "0")
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome: t("admin.msg.valueInvalid"),
    });
  const on = raw === "1";
  if (on && isExpired(g.expiresAt, Date.now()))
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome: t("admin.msg.homeExpired"),
    });
  if (on && (g.pinHash !== null || g.status !== "published"))
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome:
        g.pinHash !== null
          ? t("admin.msg.homePin")
          : t("admin.msg.homeUnpublished"),
    });
  await getDb(env)
    .update(schema.galleries)
    .set({ showOnHome: on })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, on ? t("admin.msg.homeOn") : t("admin.msg.homeOff"));
}

/** Design (T6.5): enums only; an absent key keeps the stored value. */
async function saveDesign(env: Env, g: GalleryRow, f: FormData, t: TFunction) {
  const intent = "design";
  const pick = <T extends string>(
    key: string,
    ok: (v: unknown) => v is T,
    current: T,
    msg: string,
    errors: Record<string, string>,
  ): T => {
    const raw = f.get(key);
    if (raw === null) return current;
    if (typeof raw === "string" && ok(raw)) return raw;
    errors[key] = msg;
    return current;
  };
  const errors: Record<string, string> = {};
  const palette = pick(
    "palette",
    isPalette,
    g.palette,
    t("admin.msg.paletteInvalid"),
    errors,
  );
  const coverLayout = pick(
    "coverLayout",
    isCoverLayout,
    g.coverLayout,
    t("admin.msg.coverLayoutInvalid"),
    errors,
  );
  const gridStyle = pick(
    "gridStyle",
    isGridStyle,
    g.gridStyle,
    t("admin.msg.gridStyleInvalid"),
    errors,
  );
  const gridGap = pick(
    "gridGap",
    isGridGap,
    g.gridGap,
    t("admin.msg.gridGapInvalid"),
    errors,
  );
  if (Object.keys(errors).length)
    return fail(intent, t("admin.msg.checkFields"), errors);
  await getDb(env)
    .update(schema.galleries)
    .set({ palette, coverLayout, gridStyle, gridGap })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.designSaved"));
}

async function changeStatus(
  env: Env,
  g: GalleryRow,
  to: string,
  t: TFunction,
  deps?: GalleryActionDeps,
) {
  const intent = "status";
  const db = getDb(env);
  let from: GalleryRow["status"];
  let set: Partial<typeof schema.galleries.$inferInsert>;
  let message: string;
  switch (to) {
    case "publish":
      from = "draft";
      set = { status: "published" }; // show_on_home stays 0: needs a new opt-in
      message = t("admin.msg.published");
      break;
    case "draft":
      from = "published";
      set = { status: "draft", showOnHome: false };
      message = t("admin.msg.movedToDraft");
      break;
    case "archive":
      if (g.status === "archived") return stale();
      from = g.status;
      set = {
        status: "archived",
        showOnHome: false,
        archivedPrevStatus: g.status,
        archivedBySync: false,
      };
      message = t("admin.msg.archived");
      break;
    case "restore":
      from = "archived";
      set = {
        status: g.archivedPrevStatus ?? "draft",
        archivedPrevStatus: null,
        archivedBySync: false,
      };
      message = t("admin.msg.restored");
      break;
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
  function stale() {
    return fail(intent, t("admin.msg.stale"));
  }
  if (g.status !== from) return stale();
  // Compare-and-set: a concurrent change makes this a no-op instead of a clobber.
  const res = await db
    .update(schema.galleries)
    .set(set)
    .where(
      and(eq(schema.galleries.id, g.id), eq(schema.galleries.status, from)),
    )
    .returning({ id: schema.galleries.id });
  if (!res.length) return stale();
  // Now visible to clients: fill R2 (cover first) before the first visitor.
  if (set.status === "published") scheduleWarmAtPublish(env, deps, g.id);
  return done(intent, message);
}

async function savePin(env: Env, g: GalleryRow, f: FormData, t: TFunction) {
  const intent = "pin";
  const mode = str(f, "mode");
  const db = getDb(env);
  if (mode === "remove") {
    await db
      .update(schema.galleries)
      .set({ pinHash: null })
      .where(eq(schema.galleries.id, g.id));
    return done(intent, t("admin.msg.pinRemoved"));
  }
  if (mode !== "set") return fail(intent, t("admin.msg.unknownAction"));
  const pin = str(f, "pin");
  if (pin.length < PIN_MIN || pin.length > PIN_MAX || CONTROL_RE.test(pin))
    return fail(intent, t("admin.msg.pinCheck"), {
      pin: t("admin.msg.pinLength", { min: PIN_MIN, max: PIN_MAX }),
    });
  const pinHash = await hashPin(pin);
  // Sessions and download tokens carry pinFingerprint(pin_hash): they die with the old hash.
  await db
    .update(schema.galleries)
    .set({ pinHash, showOnHome: false })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.pinSaved"));
}

/**
 * Which cover a cover/focus form targets: absent or "desktop" = the desktop
 * cover, "mobile" = the optional mobile cover. Anything else (other strings,
 * files) is refused.
 */
function deviceOf(f: FormData): Device | null {
  const v = f.get("device");
  if (v === null || v === "desktop") return "desktop";
  return v === "mobile" ? "mobile" : null;
}

async function saveCover(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
  deps?: GalleryActionDeps,
) {
  const intent = "cover";
  const device = deviceOf(f);
  const raw = f.get("photoId");
  if (!device || (raw !== null && typeof raw !== "string"))
    return fail(intent, t("admin.msg.invalidRequest"));
  const photoId = raw ?? "";
  const db = getDb(env);
  const cols = DEVICE_FIELDS[device];
  const clear = { [cols.photo]: null, [cols.fx]: null, [cols.fy]: null };
  if (photoId === "") {
    await db
      .update(schema.galleries)
      .set(clear)
      .where(eq(schema.galleries.id, g.id));
    return done(
      intent,
      device === "mobile"
        ? t("admin.msg.coverMobileCleared")
        : t("admin.msg.coverAuto"),
    );
  }
  const [p] = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, photoId),
        eq(schema.photos.galleryId, g.id),
        photoVisible,
      ),
    );
  if (!p) return fail(intent, t("admin.msg.coverNotInGallery"));
  // A new photo resets that device's focal point to the center.
  await db
    .update(schema.galleries)
    .set({ ...clear, [cols.photo]: p.id })
    .where(eq(schema.galleries.id, g.id));
  // The new cover is about to be looked at (here and by clients): fill R2 for
  // that photo in the background so nobody waits for a cold Drive fetch.
  if (deps?.ctx && deps.drive)
    deps.ctx.waitUntil(
      warmCoverPhoto(env, deps.drive, g.id, p.id).catch(() => {
        // Best effort: the first view just streams from Drive as before.
      }),
    );
  return done(
    intent,
    device === "mobile"
      ? t("admin.msg.coverMobileSaved")
      : t("admin.msg.coverSaved"),
  );
}

// A plain decimal (optional sign/exponent); no hex, no Infinity/NaN words.
const FOCUS_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Cover focal point = a point ON THE IMAGE as percentages (u,v) of its width
 * and height. Both empty = automatic (null); else any finite number 0-100,
 * rounded to one decimal.
 */
async function saveFocus(
  env: Env,
  g: GalleryRow,
  form: FormData,
  t: TFunction,
) {
  const intent = "focus";
  const device = deviceOf(form);
  if (!device) return fail(intent, t("admin.msg.invalidRequest"));
  if (device === "mobile") {
    // A mobile focal point only means something for a (visible) mobile cover.
    const [p] = g.coverPhotoIdMobile
      ? await getDb(env)
          .select({ id: schema.photos.id })
          .from(schema.photos)
          .where(
            and(
              eq(schema.photos.id, g.coverPhotoIdMobile),
              eq(schema.photos.galleryId, g.id),
              photoVisible,
            ),
          )
      : [];
    if (!p) return fail(intent, t("admin.msg.focusNoMobileCover"));
  }
  const rx = str(form, "focusX").trim();
  const ry = str(form, "focusY").trim();
  let x: number | null = null;
  let y: number | null = null;
  if (rx !== "" || ry !== "") {
    x = FOCUS_RE.test(rx) ? Number(rx) : Number.NaN;
    y = FOCUS_RE.test(ry) ? Number(ry) : Number.NaN;
    if (
      !(Number.isFinite(x) && Number.isFinite(y)) ||
      !(x >= 0 && x <= 100 && y >= 0 && y <= 100)
    )
      return fail(intent, t("admin.msg.focusRange"));
    x = round1(x);
    y = round1(y);
  }
  await getDb(env)
    .update(schema.galleries)
    .set({ [DEVICE_FIELDS[device].fx]: x, [DEVICE_FIELDS[device].fy]: y })
    .where(eq(schema.galleries.id, g.id));
  return done(
    intent,
    x === null ? t("admin.msg.focusCentered") : t("admin.msg.focusSaved"),
  );
}

function parseOrder(raw: string): Record<string, string[]> | null {
  if (!raw || raw.length > ORDER_MAX_CHARS) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = Object.create(null);
  for (const [k, ids] of Object.entries(v)) {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))
      return null;
    out[k] = ids as string[];
  }
  return out;
}

async function reorder(env: Env, g: GalleryRow, f: FormData, t: TFunction) {
  const intent = "reorder";
  const db = getDb(env);
  const order = parseOrder(str(f, "order"));
  if (!order) return fail(intent, t("admin.msg.orderInvalid"));
  const current = await db
    .select({
      id: schema.photos.id,
      set: schema.photos.setName,
      sort: schema.photos.sort,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible));
  if ((await photoSetVersion(current.map((p) => p.id))) !== str(f, "version"))
    return fail(intent, t("admin.msg.orderStale"), undefined, { stale: true });
  const byId = new Map(current.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const writes: { id: string; sort: number }[] = [];
  for (const [set, ids] of Object.entries(order)) {
    for (const [i, pid] of ids.entries()) {
      const p = byId.get(pid);
      if (!p || p.set !== set || seen.has(pid))
        return fail(intent, t("admin.msg.orderInvalid"));
      seen.add(pid);
      if (p.sort !== i) writes.push({ id: pid, sort: i });
    }
  }
  if (seen.size !== byId.size) return fail(intent, t("admin.msg.orderInvalid"));

  // One CASE update per chunk, all chunks in a single batch (a D1 batch is a
  // transaction), so a failure never leaves a half-applied order.
  const stmts: BatchItem[] = [];
  for (let i = 0; i < writes.length; i += REORDER_CHUNK) {
    const part = writes.slice(i, i + REORDER_CHUNK);
    const cases = sql.join(
      part.map(
        (w) => sql`WHEN ${w.id} THEN ${sql.raw(String(Math.trunc(w.sort)))}`,
      ),
      sql` `,
    );
    stmts.push(
      db
        .update(schema.photos)
        .set({ sort: sql`CASE ${schema.photos.id} ${cases} END` })
        .where(
          and(
            eq(schema.photos.galleryId, g.id),
            inArray(
              schema.photos.id,
              part.map((w) => w.id),
            ),
          ),
        ),
    );
  }
  if (stmts.length) await db.batch(stmts as [BatchItem, ...BatchItem[]]);
  return done(intent, t("admin.msg.orderSaved"));
}
