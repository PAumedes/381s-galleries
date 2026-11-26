import { IMAGE_VARIANTS, type ImageVariant } from "../constants";
import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import {
  accessSelect,
  clientIpHash,
  openGallery,
  withClientPin,
} from "./access";
import {
  isValidHit,
  pendingFill,
  safeType,
  storeInCache,
  waitForFill,
} from "./image-cache";
import {
  adminImageToken,
  IMMUTABLE_CACHE_CONTROL,
  cacheKey,
  imageVersionToken,
  resolveSource,
} from "./image-source";
import type { Source } from "./image-source";
import {
  askedVersion,
  atLatestVersion,
  atVersion,
  loadVersionsOf,
} from "./photo-versions";
import { hit as rateHit, retryAfterFor, type RateRule } from "./rate-limit";
import { mockImageUrl } from "./drive-mock";
import type { MockVariant } from "./drive-mock";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";
import { NO_STORE, NOSNIFF, textResponse } from "./http";

export type Variant = ImageVariant;

/** Pre-refactor name for the variant list; kept for existing importers. */
export { IMAGE_VARIANTS as VARIANTS };

export {
  adminImageToken,
  IMMUTABLE_CACHE_CONTROL,
  imageVersionToken,
  resolveSource,
} from "./image-source";
export type { Source, SourcePhoto } from "./image-source";
export {
  fillCache,
  fillCacheShared,
  PENDING_FILL_WAIT_MS,
  pendingFill,
} from "./image-cache";
export type { FillResult } from "./image-cache";

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

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const strip = (s: string) => s.trim().replace(/^W\//, "");
  return header
    .split(",")
    .some((t) => strip(t) === "*" || strip(t) === strip(etag));
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

/** The variant asked for, resolved to a real one; null when it is not servable here. */
function resolveVariant(
  variant: string | undefined,
  admin: boolean,
): { v: Variant; adminWm: boolean } | null {
  if (!variant) return null;
  const adminWm = admin && Object.hasOwn(ADMIN_WM_VARIANTS, variant);
  if (adminWm) return { v: ADMIN_WM_VARIANTS[variant], adminWm };
  if (!(IMAGE_VARIANTS as readonly string[]).includes(variant)) return null;
  if (admin && variant === "view-lg") return null;
  return { v: variant as Variant, adminWm };
}

async function loadVisiblePhoto(env: Env, photoId: string) {
  const rows = await getDb(env)
    .select({ photo: schema.photos, ...accessSelect })
    .from(schema.photos)
    .innerJoin(
      schema.galleries,
      eq(schema.galleries.id, schema.photos.galleryId),
    )
    .leftJoin(schema.clients, eq(schema.galleries.clientId, schema.clients.id))
    .where(and(eq(schema.photos.id, photoId), photoVisible))
    .limit(1);
  return rows[0] && { photo: rows[0].photo, gallery: withClientPin(rows[0]) };
}

type PhotoRow = typeof schema.photos.$inferSelect;
/** A photo row at the version a request is about (T6.53c): `version` decides its R2 key. */
type ServedPhoto = PhotoRow & { version?: number };

/**
 * The photo as this request sees it. An album with versioning off is the
 * `photos` row as before (and has no `ver`). A versioned one serves the
 * version asked with `?ver=N` (live rows only, so never one whose file left
 * Drive), else the version its gallery shows. null = 404.
 */
async function servedPhoto(
  request: Request,
  env: Env,
  photo: PhotoRow,
  gallery: { versioning: boolean; mode: string },
): Promise<ServedPhoto | null> {
  const asked = askedVersion(new URL(request.url));
  if (asked === "bad") return null;
  if (!gallery.versioning) return asked === null ? photo : null;
  const live = (await loadVersionsOf(env, [photo.id])).get(photo.id) ?? [];
  if (asked === null)
    return atLatestVersion(photo, live, gallery.mode === "proofing");
  const row = live.find((r) => r.version === asked);
  return row ? atVersion(photo, row) : null;
}

function mockRedirect(photo: ServedPhoto, src: Source, v: Variant): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...BASE_HEADERS,
      Location: mockImageUrl(
        photo.id,
        src.watermark && v !== "thumb" ? "wm" : MOCK_KIND[v],
        photo.width ?? 0,
        photo.height ?? 0,
      ),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/**
 * A request whose ?v= equals the current version token may be cached for a
 * year (the URL changes whenever the file, watermark flag or version does).
 * Otherwise <=10 min browser staleness is accepted (PLAN 5.3).
 * Admin images: same idea with their own token (`adminImageToken`); without
 * a matching one they stay `no-store`.
 */
async function cacheControlFor(
  request: Request,
  env: Env,
  photo: ServedPhoto,
  proofing: boolean,
  admin: boolean,
): Promise<string> {
  const asked = new URL(request.url).searchParams.get("v");
  const current = asked
    ? admin
      ? await adminImageToken(env, photo)
      : await imageVersionToken(env, photo, proofing)
    : null;
  if (asked && asked === current) return IMMUTABLE_CACHE_CONTROL;
  return admin ? "private, no-store" : "private, max-age=600";
}

/** R2 lookup; a warm already fetching this very file is waited for instead of a second Drive stream. */
async function readCached(
  env: Env,
  key: string,
  src: Source,
  bypass: boolean,
): Promise<R2ObjectBody | null> {
  const lookup = async () => {
    if (bypass) return null;
    const found = await env.CACHE.get(key);
    if (found && !isValidHit(found, src)) {
      await found.body.cancel();
      return null;
    }
    return found;
  };
  const hit = await lookup();
  const pending = hit || bypass ? undefined : pendingFill(key, src);
  if (!pending) return hit;
  await waitForFill(pending);
  return lookup();
}

async function cachedResponse(
  request: Request,
  hit: R2ObjectBody,
  cacheControl: string,
): Promise<Response> {
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

/** R2 miss: about to spend Drive quota. Hits are free and unlimited. A 429 response when over the limit. */
async function missRateLimited(
  request: Request,
  env: Env,
  galleryId: string,
): Promise<Response | null> {
  const ipHash =
    (await clientIpHash(request, env, { prefix64: true })) ?? "noip";
  const key = `${ipHash}:${galleryId}`;
  if (await rateHit(env, IMG_MISS_RATE, key)) return null;
  return textResponse("Too many requests", 429, {
    ...BASE_HEADERS,
    "Cache-Control": NO_STORE,
    "Retry-After": String(await retryAfterFor(env, IMG_MISS_RATE, key)),
  });
}

/** Drive stream for a miss, or the error response (404 gone, 502 otherwise). */
async function fetchUpstream(
  drive: DriveClient,
  fileId: string,
): Promise<{ upstream: Response } | { error: Response }> {
  try {
    const upstream = await drive.streamFile(fileId);
    return upstream.body ? { upstream } : { error: badGateway() };
  } catch (err) {
    if (err instanceof DriveError && err.status === 404)
      return { error: notFound() };
    console.error(
      "img: drive error",
      err instanceof DriveError ? err.status : "error",
    );
    return { error: badGateway() };
  }
}

/** Content-Length as a non-negative integer, or null when absent/unusable. */
function contentLengthOf(upstream: Response): number | null {
  const raw = upstream.headers.get("Content-Length")?.trim();
  const length = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(length) && length >= 0 ? length : null;
}

interface MissContext {
  env: Env;
  ctx: Pick<ExecutionContext, "waitUntil">;
  key: string;
  src: Source;
  cacheControl: string;
  /** Admin clean/watermark files never share R2 keys with the public ones. */
  adminClean: boolean;
}

/**
 * Streams the Drive response to the client and, when its length and version
 * are known, tees it into R2 (best-effort, after the response).
 */
async function streamAndCache(
  upstream: Response,
  m: MissContext,
): Promise<Response> {
  const contentType = safeType(upstream.headers.get("Content-Type"));
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": m.cacheControl,
  };
  const length = contentLengthOf(upstream);
  if (length === 0) {
    await upstream.body!.cancel();
    return badGateway();
  }
  // Without a known source version a cached copy could never be validated.
  if (length === null || !m.src.version || m.adminClean)
    return new Response(upstream.body, { status: 200, headers });

  headers["Content-Length"] = String(length);
  const [toClient, toCache] = upstream.body!.tee();
  m.ctx.waitUntil(
    storeInCache(m.env, m.key, toCache, length, contentType, {
      fileId: m.src.fileId,
      wm: m.src.watermark ? "1" : "0",
      v: m.src.version,
    }).catch(() => {
      // Caching is best-effort; the client already got the image.
    }),
  );
  return new Response(toClient, { status: 200, headers });
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
  const { photoId } = params;
  const admin = !!opts.admin;
  const resolved = resolveVariant(params.variant, admin);
  if (!photoId || !resolved) return notFound();
  const { v, adminWm } = resolved;

  const row = await loadVisiblePhoto(env, photoId);
  if (!row) return notFound();
  const { gallery } = row;
  if (!admin && !(await openGallery(request, gallery, env))) return notFound();
  const photo = await servedPhoto(request, env, row.photo, gallery);
  if (!photo) return notFound();

  const proofing = gallery.mode === "proofing";
  const src = resolveSource(photo, adminWm || (proofing && !admin), v);
  if (!src) return notFound();
  if (env.DRIVE_MODE === "mock") return mockRedirect(photo, src, v);

  // Admin clean files in Prueba, and admin watermarked files outside Prueba,
  // must not share R2 keys with the public objects (clean vs watermarked), so
  // they bypass the cache. A watermarked file in Prueba is exactly what the
  // public gets: it reads (validated by isValidHit) and fills the same key.
  const adminClean = admin && (src.watermark ? !proofing : proofing);
  const key = cacheKey(photo, v);
  const cacheControl = await cacheControlFor(
    request,
    env,
    photo,
    proofing,
    admin,
  );
  const hit = await readCached(env, key, src, adminClean);
  if (hit) return cachedResponse(request, hit, cacheControl);

  if (!admin) {
    const limited = await missRateLimited(request, env, gallery.id);
    if (limited) return limited;
  }
  const fetched = await fetchUpstream(deps.drive, src.fileId);
  if ("error" in fetched) return fetched.error;
  return streamAndCache(fetched.upstream, {
    env,
    ctx,
    key,
    src,
    cacheControl,
    adminClean,
  });
}
