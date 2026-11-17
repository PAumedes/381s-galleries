import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type { Db } from "../../db";
import {
  baLocalToUtcIso,
  groupIssues,
  isValidDate,
  utcIsoToBaLocal,
} from "../admin-gallery";
import type { Filter } from "../admin-gallery";
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
export const PIN_MIN = 4;
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
): Promise<GalleryListRow[]> {
  const g = schema.galleries;
  const status = FILTER_STATUS[filter];
  const rows = await getDb(env)
    .select({
      id: g.id,
      title: g.title,
      slug: g.slug,
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
  return rows.map(({ syncIssuesJson, ...r }) => ({
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
      hasWm: sql<number>`(${schema.photos.driveWmId} IS NOT NULL)`,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  const photos: EditPhoto[] = ps.map(({ hasWm: _w, ...p }) => p);
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
      useWatermarkPreview: g.useWatermarkPreview,
      hasPin: g.pinHash !== null,
      coverPhotoId: ps.some((p) => p.id === g.coverPhotoId)
        ? g.coverPhotoId
        : null,
    },
    hasWmFiles: ps.some((p) => p.hasWm),
    photos,
    version: await photoSetVersion(photos.map((p) => p.id)),
    issues: groupIssues(g.syncIssuesJson),
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
    return fail("", "Solicitud inválida.");
  }
  const intent = str(form, "intent");
  switch (intent) {
    case "details":
      return saveDetails(env, g, form);
    case "flags":
      return saveFlags(env, g, form);
    case "status":
      return changeStatus(env, g, str(form, "to"));
    case "pin":
      return savePin(env, g, form);
    case "cover":
      return saveCover(env, g, str(form, "photoId"));
    case "reorder":
      return reorder(env, g, form);
    default:
      return fail(intent, "Acción desconocida.");
  }
}

type GalleryRow = typeof schema.galleries.$inferSelect;

async function saveDetails(env: Env, g: GalleryRow, f: FormData) {
  const intent = "details";
  const errors: Record<string, string> = {};

  const title = str(f, "title").trim();
  if (title.length < 1 || title.length > TITLE_MAX || CONTROL_RE.test(title))
    errors.title = `El título debe tener entre 1 y ${TITLE_MAX} caracteres.`;

  const clientRaw = str(f, "clientName").trim();
  if (clientRaw.length > CLIENT_MAX || CONTROL_RE.test(clientRaw))
    errors.clientName = `El nombre del cliente no puede superar los ${CLIENT_MAX} caracteres.`;

  const slug = str(f, "slug").trim().toLowerCase();
  if (RESERVED_SLUGS.includes(slug))
    errors.slug = "Ese slug está reservado. Elegí otro.";
  else if (!slug || slug.length > SLUG_MAX || !SLUG_RE.test(slug))
    errors.slug = `Usá solo letras minúsculas, números y guiones (1 a ${SLUG_MAX} caracteres, sin guiones al inicio, al final ni repetidos).`;

  const eventDate = str(f, "eventDate").trim();
  if (eventDate && !isValidDate(eventDate))
    errors.eventDate = "La fecha del evento no es válida.";

  const expDate = str(f, "expiresDate").trim();
  const expTime = str(f, "expiresTime").trim();
  let expiresAt: string | null = null;
  if (expDate || expTime) {
    const yr = Number(expDate.slice(0, 4));
    if (expDate && (yr < EXPIRY_YEAR_MIN || yr > EXPIRY_YEAR_MAX))
      errors.expires = `El año de vencimiento debe estar entre ${EXPIRY_YEAR_MIN} y ${EXPIRY_YEAR_MAX}.`;
    else {
      // A date without a time means "until the end of that day" (Buenos Aires).
      expiresAt = expDate ? baLocalToUtcIso(expDate, expTime || "23:59") : null;
      if (!expiresAt)
        errors.expires = expDate
          ? "La fecha de vencimiento no es válida."
          : "Indicá también la fecha de vencimiento.";
    }
  }

  if (
    !errors.slug &&
    slug !== g.slug.toLowerCase() &&
    (await slugTaken(env, slug, g.id))
  )
    errors.slug = "Ese slug ya está en uso por otra galería.";

  if (Object.keys(errors).length)
    return fail(intent, "Revisá los campos marcados.", errors);

  try {
    await getDb(env)
      .update(schema.galleries)
      .set({
        title,
        slug,
        clientName: clientRaw || null,
        eventDate: eventDate || null,
        expiresAt,
      })
      .where(eq(schema.galleries.id, g.id));
  } catch (err) {
    if (isConstraintError(err))
      return fail(intent, "Revisá los campos marcados.", {
        slug: "Ese slug ya está en uso por otra galería.",
      });
    throw err;
  }
  return done(intent, "Datos guardados.");
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

async function saveFlags(env: Env, g: GalleryRow, f: FormData) {
  const intent = "flags";
  const on = (k: string) => f.get(k) === "1";
  const wm = on("useWatermarkPreview");
  if (wm) {
    const [r] = await getDb(env)
      .select({ n: sql<number>`count(*)` })
      .from(schema.photos)
      .where(
        and(
          eq(schema.photos.galleryId, g.id),
          photoVisible,
          sql`${schema.photos.driveWmId} IS NOT NULL`,
        ),
      );
    if (!r?.n)
      return fail(intent, "Revisá los campos marcados.", {
        useWatermarkPreview:
          "Esta galería no tiene archivos preview-wm: no se puede activar la marca de agua.",
      });
  }
  await getDb(env)
    .update(schema.galleries)
    .set({
      allowHighres: on("allowHighres"),
      allowWeb: on("allowWeb"),
      allowIg: on("allowIg"),
      allowBulk: on("allowBulk"),
      requireEmail: on("requireEmail"),
      useWatermarkPreview: wm,
    })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, "Opciones guardadas.");
}

async function changeStatus(env: Env, g: GalleryRow, to: string) {
  const intent = "status";
  const db = getDb(env);
  let from: GalleryRow["status"];
  let set: Partial<typeof schema.galleries.$inferInsert>;
  let message: string;
  switch (to) {
    case "publish":
      from = "draft";
      set = { status: "published" };
      message = "Galería publicada.";
      break;
    case "draft":
      from = "published";
      set = { status: "draft" };
      message = "La galería pasó a borrador.";
      break;
    case "archive":
      if (g.status === "archived") return stale();
      from = g.status;
      set = {
        status: "archived",
        archivedPrevStatus: g.status,
        archivedBySync: false,
      };
      message = "Galería archivada.";
      break;
    case "restore":
      from = "archived";
      set = {
        status: g.archivedPrevStatus ?? "draft",
        archivedPrevStatus: null,
        archivedBySync: false,
      };
      message = "Galería restaurada.";
      break;
    default:
      return fail(intent, "Acción desconocida.");
  }
  function stale() {
    return fail(
      intent,
      "Ese cambio no es posible desde el estado actual. Recargá la página.",
    );
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

async function savePin(env: Env, g: GalleryRow, f: FormData) {
  const intent = "pin";
  const mode = str(f, "mode");
  const db = getDb(env);
  if (mode === "remove") {
    await db
      .update(schema.galleries)
      .set({ pinHash: null })
      .where(eq(schema.galleries.id, g.id));
    return done(
      intent,
      "PIN eliminado. Las sesiones y enlaces de descarga anteriores quedaron sin efecto.",
    );
  }
  if (mode !== "set") return fail(intent, "Acción desconocida.");
  const pin = str(f, "pin");
  if (pin.length < PIN_MIN || pin.length > PIN_MAX || CONTROL_RE.test(pin))
    return fail(intent, "Revisá el PIN.", {
      pin: `El PIN debe tener entre ${PIN_MIN} y ${PIN_MAX} caracteres.`,
    });
  const pinHash = await hashPin(pin);
  // Sessions and download tokens carry pinFingerprint(pin_hash): they die with the old hash.
  await db
    .update(schema.galleries)
    .set({ pinHash })
    .where(eq(schema.galleries.id, g.id));
  return done(
    intent,
    "PIN guardado. Las sesiones y enlaces de descarga anteriores quedaron sin efecto.",
  );
}

async function saveCover(env: Env, g: GalleryRow, photoId: string) {
  const intent = "cover";
  const db = getDb(env);
  if (photoId === "") {
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: null })
      .where(eq(schema.galleries.id, g.id));
    return done(intent, "Portada automática (primera foto).");
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
  if (!p)
    return fail(
      intent,
      "Esa foto no pertenece a la galería o no está visible.",
    );
  await db
    .update(schema.galleries)
    .set({ coverPhotoId: p.id })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, "Portada guardada.");
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

async function reorder(env: Env, g: GalleryRow, f: FormData) {
  const intent = "reorder";
  const db = getDb(env);
  const order = parseOrder(str(f, "order"));
  if (!order) return fail(intent, "El orden enviado no es válido.");
  const current = await db
    .select({
      id: schema.photos.id,
      set: schema.photos.setName,
      sort: schema.photos.sort,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible));
  if ((await photoSetVersion(current.map((p) => p.id))) !== str(f, "version"))
    return fail(
      intent,
      "Las fotos de la galería cambiaron desde que abriste esta página (por ejemplo, por una sincronización). Recargá la página y volvé a ordenar.",
      undefined,
      { stale: true },
    );
  const byId = new Map(current.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const writes: { id: string; sort: number }[] = [];
  for (const [set, ids] of Object.entries(order)) {
    for (const [i, pid] of ids.entries()) {
      const p = byId.get(pid);
      if (!p || p.set !== set || seen.has(pid))
        return fail(intent, "El orden enviado no es válido.");
      seen.add(pid);
      if (p.sort !== i) writes.push({ id: pid, sort: i });
    }
  }
  if (seen.size !== byId.size)
    return fail(intent, "El orden enviado no es válido.");

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
  return done(intent, "Orden guardado.");
}
