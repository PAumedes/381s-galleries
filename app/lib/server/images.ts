import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import { clientIpHash, openGallery } from "./access";
import { shortMac } from "./crypto";
import { rateLimit, retryAfterSeconds } from "./rate-limit";
import { mockImageUrl } from "./drive-mock";
import type { MockVariant } from "./drive-mock";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";

export const VARIANTS = ["thumb", "view-sm", "view-lg"] as const;
export type Variant = (typeof VARIANTS)[number];

const MOCK_KIND: Record<Variant, MockVariant> = {
  thumb: "thumb",
  "view-sm": "web",
  "view-lg": "highres",
};

/** Drive fetches (R2 misses) per IP and gallery per window. */
export const IMG_MISS_MAX = 5000;
export const IMG_MISS_WINDOW_MS = 10 * 60 * 1000;

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff" };

/** Identical for "no such photo", "not visible", "locked" and "invalid variant". */
function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function badGateway(): Response {
  return new Response("Bad gateway", {
    status: 502,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
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
  const asked = new URL(request.url).searchParams.get("v");
  const cacheControl =
    asked && asked === (await imageVersionToken(env, photo, proofing))
      ? IMMUTABLE_CACHE_CONTROL
      : "private, max-age=600";
  const wmFlag = watermark ? "1" : "0";
  let hit = adminClean ? null : await env.CACHE.get(key);
  if (hit && !isValidHit(hit, src)) {
    await hit.body.cancel();
    hit = null;
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
    const ipHash = (await clientIpHash(request, env)) ?? "noip";
    const key = `${ipHash}:${gallery.id}`;
    if (!(await rateLimit(env, "img", key, IMG_MISS_MAX, IMG_MISS_WINDOW_MS))) {
      return new Response("Too many requests", {
        status: 429,
        headers: {
          ...BASE_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(
            await retryAfterSeconds(env, "img", key, IMG_MISS_WINDOW_MS),
          ),
        },
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
