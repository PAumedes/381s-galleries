import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type { Db } from "../../db";
import {
  baLocalToUtcIso,
  groupIssues,
  ISSUE_LABELS,
  isValidDate,
  normalizeSearch,
  utcIsoToBaLocal,
} from "../admin-gallery";
import type { Filter } from "../admin-gallery";
import { isCoverLayout, isGridGap, isGridStyle, isPalette } from "../design";
import { requestT } from "../../i18n/dictionaries";
import type { TFunction } from "../../i18n/t";
import { adminAction } from "./admin";
import { hashPin } from "./crypto";
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

export interface GalleryListRow {
  id: string;
  title: string;
  slug: string;
  clientName: string | null;
  eventDate: string | null;
  status: "draft" | "published" | "archived";
  expiresAt: string | null;
  expired: boolean;
  /** Chosen cover when visible, else the first visible photo, else null. */
  coverPhotoId: string | null;
  photoCount: number;
  views: number;
  /** Per-photo download rows only (bulk header rows are excluded). */
  downloads: number;
  issueCount: number;
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
      expiresAt: g.expiresAt,
      syncIssuesJson: g.syncIssuesJson,
      coverPhotoId: sql<string | null>`COALESCE(
        (SELECT p.id FROM photos p WHERE p.id = galleries.cover_photo_id AND p.gallery_id = galleries.id AND p.missing_since IS NULL),
        (SELECT p.id FROM photos p WHERE p.gallery_id = galleries.id AND p.missing_since IS NULL ORDER BY p.set_name, p.sort, p.base_name LIMIT 1))`,
      photoCount: sql<number>`(SELECT count(*) FROM photos p WHERE p.gallery_id = galleries.id AND p.missing_since IS NULL)`,
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
      hasWm: sql<number>`(${schema.photos.driveWmId} IS NOT NULL)`,
      hasThumbWm: sql<number>`(${schema.photos.driveThumbWmId} IS NOT NULL)`,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  const photos: EditPhoto[] = ps.map(
    ({ hasWm: _w, hasThumbWm: _t, ...p }) => p,
  );
  // Proofing serves only preview-wm: photos without it 404 for clients.
  const noWm = ps.filter((p) => !p.hasWm);
  const issues = groupIssues(g.syncIssuesJson);
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
      expires: utcIsoToBaLocal(g.expiresAt),
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
      coverPhotoId: ps.some((p) => p.id === g.coverPhotoId)
        ? g.coverPhotoId
        : null,
      coverFocus:
        g.coverFocusX !== null && g.coverFocusY !== null
          ? { x: g.coverFocusX, y: g.coverFocusY }
          : null,
    },
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

export async function galleryAction(
  request: Request,
  env: Env,
  id: string,
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
      return changeStatus(env, g, str(form, "to"), t);
    case "pin":
      return savePin(env, g, form, t);
    case "cover":
      return saveCover(env, g, str(form, "photoId"), t);
    case "focus":
      return saveFocus(env, g, form, t);
    case "reorder":
      return reorder(env, g, form, t);
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
}

type GalleryRow = typeof schema.galleries.$inferSelect;

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
      // A date without a time means "until the end of that day" (Buenos Aires).
      expiresAt = expDate ? baLocalToUtcIso(expDate, expTime || "23:59") : null;
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
  const mode: "proofing" | "delivery" = modeRaw ?? g.mode;
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

async function changeStatus(env: Env, g: GalleryRow, to: string, t: TFunction) {
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
  return res.length ? done(intent, message) : stale();
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

async function saveCover(
  env: Env,
  g: GalleryRow,
  photoId: string,
  t: TFunction,
) {
  const intent = "cover";
  const db = getDb(env);
  if (photoId === "") {
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: null, coverFocusX: null, coverFocusY: null })
      .where(eq(schema.galleries.id, g.id));
    return done(intent, t("admin.msg.coverAuto"));
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
  await db
    .update(schema.galleries)
    .set({ coverPhotoId: p.id, coverFocusX: null, coverFocusY: null })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.coverSaved"));
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
    .set({ coverFocusX: x, coverFocusY: y })
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
