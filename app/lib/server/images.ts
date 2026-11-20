import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import { clientIpHash, openGallery } from "./access";
import { shortMac } from "./crypto";
import { hit as rateHit, retryAfterFor, type RateRule } from "./rate-limit";
import { mockImageUrl } from "./drive-mock";
import type { MockVariant } from "./drive-mock";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";
import { NO_STORE, NOSNIFF, textResponse } from "./http";

export const VARIANTS = ["thumb", "view-sm", "view-lg"] as const;
export type Variant = (typeof VARIANTS)[number];

const MOCK_KIND: Record<Variant, MockVariant> = {
  thumb: "thumb",
  "view-sm": "web",
  "view-lg": "highres",
};

/** Drive fetches (R2 misses) per IP and gallery per window. */
const IMG_MISS_RATE: RateRule = {
  scope: "img",
  max: 5000,
  windowMs: 10 * 60 * 1000,
};

const BASE_HEADERS = NOSNIFF;

/** Identical for "no such photo", "not visible", "locked" and "invalid variant". */
function notFound(): Response {
  return textResponse("Not found", 404, {
    ...BASE_HEADERS,
    "Cache-Control": NO_STORE,
  });
}

function badGateway(): Response {
  return textResponse("Bad gateway", 502, {
    ...BASE_HEADERS,
    "Cache-Control": NO_STORE,
  });
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
function safeType(raw: string | null | undefined): string {
  const t = (raw ?? "").split(";")[0].trim().toLowerCase();
  return IMAGE_TYPES.includes(t) ? t : "image/jpeg";
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const strip = (s: string) => s.trim().replace(/^W\//, "");
  return header
    .split(",")
    .some((t) => strip(t) === "*" || strip(t) === strip(etag));
}

/** Manual pump: pipeTo into a FixedLengthStream is unsupported for tee()d branches in workerd. */
async function pump(
  src: ReadableStream<Uint8Array>,
  dst: WritableStream<Uint8Array>,
): Promise<void> {
  const reader = src.getReader();
  const writer = dst.getWriter();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (err) {
    await writer.abort(err).catch(() => {});
    throw err;
  }
}

/** Drive modifiedTime of the resolved source file, from photos.variant_versions ("" if unknown). */
function sourceVersion(photo: SourcePhoto, fileId: string): string {
  const ids = {
    highres: photo.driveHighresId,
    web: photo.driveWebId,
    ig: photo.driveIgId,
    thumb: photo.driveThumbId,
    wm: photo.driveWmId,
    thumbWm: photo.driveThumbWmId,
  } as const;
  const name = (Object.keys(ids) as (keyof typeof ids)[]).find(
    (k) => ids[k] === fileId,
  );
  if (!name || !photo.variantVersions) return "";
  try {
    const m: unknown = JSON.parse(photo.variantVersions);
    const t = (m as Record<string, unknown> | null)?.[name];
    return typeof t === "string" ? t : "";
  } catch {
    return "";
  }
}

export const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";

type Photo = typeof schema.photos.$inferSelect;
/** The columns that decide which Drive file serves a variant. */
export type SourcePhoto = Pick<
  Photo,
  | "id"
  | "driveHighresId"
  | "driveWebId"
  | "driveIgId"
  | "driveThumbId"
  | "driveWmId"
  | "variantVersions"
> & {
  /** Optional watermarked 600px thumb (`thumb-wm`); absent on older rows. */
  driveThumbWmId?: string | null;
};

export interface Source {
  fileId: string;
  /** true when the file is a watermarked one (proofing mode). */
  watermark: boolean;
  /** Drive modifiedTime of the file ("" if unknown: then it is never cached). */
  version: string;
}

/**
 * Which Drive file serves `variant` of `photo` (PLAN 5.3 mode policy and
 * fallbacks), or null when none exists (404). Shared by /img and cache warming.
 *
 * `proofing` (gallery mode Prueba): everything public is watermarked:
 * thumb = thumb-wm ?? preview-wm, view-* = preview-wm; never a clean file.
 * Delivery: thumb ?? web ?? high-res, web ?? high-res, high-res (never wm).
 */
export function resolveSource(
  photo: SourcePhoto,
  proofing: boolean,
  variant: Variant,
): Source | null {
  const fileId = proofing
    ? variant === "thumb"
      ? (photo.driveThumbWmId ?? photo.driveWmId)
      : photo.driveWmId
    : variant === "thumb"
      ? (photo.driveThumbId ?? photo.driveWebId ?? photo.driveHighresId)
      : variant === "view-sm"
        ? (photo.driveWebId ?? photo.driveHighresId)
        : photo.driveHighresId;
  if (!fileId) return null;
  return { fileId, watermark: proofing, version: sourceVersion(photo, fileId) };
}

/**
 * Short opaque token of what a photo's three image URLs currently resolve to
 * (file ids, watermark flags, modified times). HMAC with SESSION_SECRET, so
 * Drive ids are not recoverable from it. Used as `?v=` on image URLs.
 * Null when any served variant has an unknown version: such a token could not
 * change when the file does, so it must never enable immutable caching.
 */
export async function imageVersionToken(
  env: Pick<Env, "SESSION_SECRET">,
  photo: SourcePhoto,
  proofing: boolean,
): Promise<string | null> {
  const parts: string[] = [];
  for (const variant of VARIANTS) {
    const s = resolveSource(photo, proofing, variant);
    if (!s) {
      parts.push("-");
      continue;
    }
    if (!s.version) return null;
    parts.push(`${s.fileId}|${s.watermark ? 1 : 0}|${s.version}`);
  }
  if (parts.every((x) => x === "-")) return null;
  return shortMac(env.SESSION_SECRET, parts.join("\n"));
}

/**
 * Token of everything the ADMIN image routes can serve for `photo`: clean and
 * watermarked thumb / view-sm (file ids, watermark flags, modified times).
 * HMAC (SESSION_SECRET, own domain prefix), 16 hex chars, so Drive ids are not
 * recoverable. Used as `?v=` on `/admin/img` URLs: a matching one lets the
 * admin's browser keep the image privately; any re-export or file change
 * changes the token. Null when a served variant has an unknown version (such
 * a token could not change with the file), or when there is nothing to serve.
 */
export async function adminImageToken(
  env: Pick<Env, "SESSION_SECRET">,
  photo: SourcePhoto,
): Promise<string | null> {
  const parts: string[] = [];
  for (const proofing of [false, true]) {
    for (const variant of ["thumb", "view-sm"] as const) {
      const s = resolveSource(photo, proofing, variant);
      if (!s) {
        parts.push("-");
        continue;
      }
      if (!s.version) return null;
      parts.push(`${s.fileId}|${s.watermark ? 1 : 0}|${s.version}`);
    }
  }
  if (parts.every((x) => x === "-")) return null;
  return shortMac(env.SESSION_SECRET, `admin\n${parts.join("\n")}`);
}

function isValidHit(hit: R2Object, src: Source): boolean {
  return (
    !!src.version &&
    hit.customMetadata?.fileId === src.fileId &&
    hit.customMetadata?.wm === (src.watermark ? "1" : "0") &&
    hit.customMetadata?.v === src.version
  );
}

async function storeInCache(
  env: Pick<Env, "CACHE">,
  key: string,
  body: ReadableStream<Uint8Array>,
  length: number,
  contentType: string,
  customMetadata: { fileId: string; wm: string; v: string },
): Promise<void> {
  const fixed = new FixedLengthStream(length);
  await Promise.all([
    pump(body, fixed.writable),
    env.CACHE.put(key, fixed.readable, {
      httpMetadata: { contentType },
      customMetadata,
    }),
  ]);
}

/** Copies the R2 object of another variant of `photoId` that is the same source file/version. */
async function copyFromSibling(
  env: Pick<Env, "CACHE">,
  photoId: string,
  variant: Variant,
  src: Source,
): Promise<boolean> {
  for (const other of VARIANTS) {
    if (other === variant) continue;
    const head = await env.CACHE.head(`${photoId}/${other}`);
    if (!head || !isValidHit(head, src)) continue;
    const obj = await env.CACHE.get(`${photoId}/${other}`);
    if (!obj) continue;
    if (!isValidHit(obj, src)) {
      await obj.body.cancel();
      continue;
    }
    await env.CACHE.put(`${photoId}/${variant}`, obj.body, {
      httpMetadata: { contentType: safeType(obj.httpMetadata?.contentType) },
      customMetadata: {
        fileId: src.fileId,
        wm: src.watermark ? "1" : "0",
        v: src.version,
      },
    });
    return true;
  }
  return false;
}

export type FillResult = "cached" | "filled" | "skipped";

/**
 * Makes sure R2 holds the current `variant` of `photo` (same resolution,
 * validation and put/customMetadata as /img). Costs one Drive call on a miss.
 * "skipped": nothing to cache (no source file / unknown version / no length).
 * Throws on Drive or R2 failure.
 */
export async function fillCache(
  env: Pick<Env, "CACHE">,
  photo: SourcePhoto & { proofing: boolean },
  variant: Variant,
  drive: DriveClient,
): Promise<FillResult> {
  const src = resolveSource(photo, photo.proofing, variant);
  if (!src || !src.version) return "skipped";
  const key = `${photo.id}/${variant}`;
  const head = await env.CACHE.head(key);
  if (head && isValidHit(head, src)) return "cached";
  // Another variant of this photo may already hold these very bytes (Prueba:
  // thumb, view-sm and view-lg are one preview-wm file): copy, don't refetch.
  if (await copyFromSibling(env, photo.id, variant, src)) return "filled";
  const upstream = await drive.streamFile(src.fileId);
  const rawLength = upstream.headers.get("Content-Length")?.trim();
  const length = rawLength ? Number(rawLength) : Number.NaN;
  if (!upstream.body || !Number.isInteger(length) || length <= 0) {
    await upstream.body?.cancel();
    return "skipped";
  }
  await storeInCache(
    env,
    key,
    upstream.body,
    length,
    safeType(upstream.headers.get("Content-Type")),
    { fileId: src.fileId, wm: src.watermark ? "1" : "0", v: src.version },
  );
  return "filled";
}

/** Fills in flight in this isolate, by R2 key AND exact source (file, watermark, version). */
const inFlight = new Map<string, Promise<FillResult>>();
/** The newest fill per R2 key, so fills of different sources for one key run in order. */
const tail = new Map<string, Promise<FillResult>>();

function fillId(key: string, src: Source | null): string {
  return src
    ? `${key}|${src.fileId}|${src.watermark ? 1 : 0}|${src.version}`
    : `${key}|-`;
}

/** The in-flight fill of exactly this R2 key and source, if one is running here. */
export function pendingFill(
  key: string,
  src: Source,
): Promise<FillResult> | undefined {
  return inFlight.get(fillId(key, src));
}

/**
 * `fillCache`, but a second caller for the same photo, variant AND source
 * while one is running awaits that one instead of fetching Drive again. A
 * caller with a different (newer) source never joins: it runs after the
 * earlier fill of that key and re-validates against its own source, so R2 ends
 * up holding what the last caller expects. Rejects like `fillCache`.
 */
export function fillCacheShared(
  env: Pick<Env, "CACHE">,
  photo: SourcePhoto & { proofing: boolean },
  variant: Variant,
  drive: DriveClient,
): Promise<FillResult> {
  const key = `${photo.id}/${variant}`;
  const id = fillId(key, resolveSource(photo, photo.proofing, variant));
  const running = inFlight.get(id);
  if (running) return running;
  const prior = tail.get(key);
  const start = prior
    ? prior
        .catch(() => undefined)
        .then(() => fillCache(env, photo, variant, drive))
    : fillCache(env, photo, variant, drive);
  const fill: Promise<FillResult> = start.finally(() => {
    inFlight.delete(id);
    if (tail.get(key) === fill) tail.delete(key);
  });
  inFlight.set(id, fill);
  tail.set(key, fill);
  return fill;
}

/** How long a visitor waits for a fill that is already running before fetching Drive itself. */
export const PENDING_FILL_WAIT_MS = 2000;

async function waitForFill(fill: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    fill.catch(() => {}),
    new Promise<void>((r) => {
      timer = setTimeout(r, PENDING_FILL_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}

export interface ImageDeps {
  drive: DriveClient;
}

/** Admin-only extra variant: the watermarked view-sm (cover preview in Prueba). */
export const ADMIN_WM_VARIANT = "view-sm-wm";
/**
 * Admin-only watermarked variants (the admin previews of a Prueba gallery
 * show what clients get): `view-sm-wm` = preview-wm, `thumb-wm` = thumb-wm,
 * else preview-wm. Never a clean fallback; never cached in R2.
 */
export const ADMIN_WM_VARIANTS: Record<string, Variant> = {
  [ADMIN_WM_VARIANT]: "view-sm",
  "thumb-wm": "thumb",
};

export interface ImageOptions {
  /**
   * Admin preview: the caller already ran `requireAdmin`. Skips the gallery
   * access checks (draft/archived/expired/PIN) and serves only thumb/view-sm;
   * the watermark policy and R2 cache rules are unchanged.
   */
  admin?: boolean;
}

/**
 * Core of GET /img/:photoId/:variant (PLAN 5.3), independent of React Router.
 *
 * Mode policy: in a proofing gallery every public variant is a watermarked
 * file (thumb-wm / preview-wm); if none exists the request is a 404 rather
 * than a clean fallback (no leak). Admin previews (`opts.admin`) always show
 * the clean files and skip R2 for proofing galleries (the keys are shared
 * with the public, watermarked objects).
 *
 * R2 caching: R2 needs a known length to store a stream, so the Drive
 * Content-Length is used with FixedLengthStream; if Drive sends none the
 * response is streamed uncached.
 */
export async function serveImage(
  request: Request,
  params: { photoId?: string; variant?: string },
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: ImageDeps,
  opts: ImageOptions = {},
): Promise<Response> {
  const { photoId, variant } = params;
  const adminWm =
    !!opts.admin && !!variant && Object.hasOwn(ADMIN_WM_VARIANTS, variant);
  if (
    !photoId ||
    !variant ||
    (!adminWm &&
      (!(VARIANTS as readonly string[]).includes(variant) ||
        (opts.admin && variant === "view-lg")))
  )
    return notFound();
  const v = (adminWm ? ADMIN_WM_VARIANTS[variant] : variant) as Variant;

  const rows = await getDb(env)
    .select({ photo: schema.photos, gallery: schema.galleries })
    .from(schema.photos)
    .innerJoin(
      schema.galleries,
      eq(schema.galleries.id, schema.photos.galleryId),
    )
    .where(and(eq(schema.photos.id, photoId), photoVisible))
    .limit(1);
  const row = rows[0];
  if (!row) return notFound();
  const { photo, gallery } = row;

  if (!opts.admin && !(await openGallery(request, gallery, env)))
    return notFound();

  const proofing = gallery.mode === "proofing";
  const src = resolveSource(photo, adminWm || (proofing && !opts.admin), v);
  if (!src) return notFound();
  // Admin clean files in Prueba, and admin watermarked files outside Prueba,
  // must not share R2 keys with the public objects (clean vs watermarked), so
  // they bypass the cache. A watermarked file in Prueba is exactly what the
  // public gets: it reads (validated by isValidHit) and fills the same key.
  const adminClean = !!opts.admin && (src.watermark ? !proofing : proofing);
  const { fileId, watermark, version } = src;

  if (env.DRIVE_MODE === "mock") {
    return new Response(null, {
      status: 302,
      headers: {
        ...BASE_HEADERS,
        Location: mockImageUrl(
          photo.id,
          watermark && v !== "thumb" ? "wm" : MOCK_KIND[v],
          photo.width ?? 0,
          photo.height ?? 0,
        ),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const key = `${photo.id}/${v}`;
  // A request whose ?v= equals the current version token may be cached for a
  // year (the URL changes whenever the file, watermark flag or version does).
  // Otherwise <=10 min browser staleness is accepted (PLAN 5.3).
  // Admin images: same idea with their own token (`adminImageToken`); without
  // a matching one they stay `no-store`.
  const asked = new URL(request.url).searchParams.get("v");
  const current = asked
    ? opts.admin
      ? await adminImageToken(env, photo)
      : await imageVersionToken(env, photo, proofing)
    : null;
  const cacheControl =
    asked && asked === current
      ? IMMUTABLE_CACHE_CONTROL
      : opts.admin
        ? "private, no-store"
        : "private, max-age=600";
  const wmFlag = watermark ? "1" : "0";
  const lookup = async () => {
    if (adminClean) return null;
    const found = await env.CACHE.get(key);
    if (found && !isValidHit(found, src)) {
      await found.body.cancel();
      return null;
    }
    return found;
  };
  let hit = await lookup();
  // A warm is already fetching this very file: wait for it instead of a second Drive stream.
  const pending = hit || adminClean ? undefined : pendingFill(key, src);
  if (pending) {
    await waitForFill(pending);
    hit = await lookup();
  }
  if (hit) {
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      ETag: hit.httpEtag,
      "Cache-Control": cacheControl,
    };
    if (etagMatches(request.headers.get("If-None-Match"), hit.httpEtag)) {
      await hit.body.cancel();
      return new Response(null, { status: 304, headers });
    }
    return new Response(hit.body, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": safeType(hit.httpMetadata?.contentType),
        "Content-Length": String(hit.size),
      },
    });
  }

  // R2 miss: about to spend Drive quota. Hits above are free and unlimited.
  if (!opts.admin) {
    const ipHash =
      (await clientIpHash(request, env, { prefix64: true })) ?? "noip";
    const key = `${ipHash}:${gallery.id}`;
    if (!(await rateHit(env, IMG_MISS_RATE, key))) {
      return textResponse("Too many requests", 429, {
        ...BASE_HEADERS,
        "Cache-Control": NO_STORE,
        "Retry-After": String(await retryAfterFor(env, IMG_MISS_RATE, key)),
      });
    }
  }

  let upstream: Response;
  try {
    upstream = await deps.drive.streamFile(fileId);
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return notFound();
    console.error(
      "img: drive error",
      err instanceof DriveError ? err.status : "error",
    );
    return badGateway();
  }
  if (!upstream.body) return badGateway();

  const contentType = safeType(upstream.headers.get("Content-Type"));
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  };
  const rawLength = upstream.headers.get("Content-Length")?.trim();
  const length = rawLength ? Number(rawLength) : Number.NaN;
  const hasLength = Number.isInteger(length) && length >= 0;
  if (hasLength && length === 0) {
    await upstream.body.cancel();
    return badGateway();
  }
  // Without a known source version a cached copy could never be validated.
  if (!hasLength || !version || adminClean)
    return new Response(upstream.body, { status: 200, headers });

  headers["Content-Length"] = String(length);
  const [toClient, toCache] = upstream.body.tee();
  ctx.waitUntil(
    storeInCache(env, key, toCache, length, contentType, {
      fileId,
      wm: wmFlag,
      v: version,
    }).catch(() => {
      // Caching is best-effort; the client already got the image.
    }),
  );
  return new Response(toClient, { status: 200, headers });
}
