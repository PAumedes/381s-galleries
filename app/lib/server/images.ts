import { and, eq } from "drizzle-orm";
import { isExpired } from "./time";
import { getDb, photoVisible, schema } from "../../db";
import { readGallerySession } from "./auth";
import { mockImageUrl } from "./drive-mock";
import type { MockVariant } from "./drive-mock";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";

const VARIANTS = ["thumb", "view-sm", "view-lg"] as const;
type Variant = (typeof VARIANTS)[number];

const MOCK_KIND: Record<Variant, MockVariant> = {
  thumb: "thumb",
  "view-sm": "web",
  "view-lg": "highres",
};

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
function sourceVersion(
  photo: typeof schema.photos.$inferSelect,
  fileId: string,
): string {
  const ids = {
    highres: photo.driveHighresId,
    web: photo.driveWebId,
    ig: photo.driveIgId,
    thumb: photo.driveThumbId,
    wm: photo.driveWmId,
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

export interface ImageDeps {
  drive: DriveClient;
}

/**
 * Core of GET /img/:photoId/:variant (PLAN 5.3), independent of React Router.
 *
 * Watermark policy: when the gallery has use_watermark_preview on, view-* only
 * ever serve the preview-wm file. If that file does not exist the request is
 * a 404 rather than falling back to the clean image (no leak).
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
): Promise<Response> {
  const { photoId, variant } = params;
  if (
    !photoId ||
    !variant ||
    !(VARIANTS as readonly string[]).includes(variant)
  )
    return notFound();
  const v = variant as Variant;

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

  if (gallery.status !== "published") return notFound();
  if (isExpired(gallery.expiresAt)) return notFound();
  if (gallery.pinHash !== null) {
    const session = await readGallerySession(
      request,
      { id: gallery.id, pinHash: gallery.pinHash },
      env,
    );
    if (!session?.unlocked) return notFound();
  }

  const watermark = v !== "thumb" && gallery.useWatermarkPreview;
  if (watermark && !photo.driveWmId) return notFound();
  const fileId =
    v === "thumb"
      ? gallery.useWatermarkPreview
        ? (photo.driveThumbId ?? photo.driveWmId)
        : (photo.driveThumbId ?? photo.driveWebId ?? photo.driveHighresId)
      : watermark
        ? photo.driveWmId
        : v === "view-sm"
          ? (photo.driveWebId ?? photo.driveHighresId)
          : photo.driveHighresId;
  if (!fileId) return notFound();

  if (env.DRIVE_MODE === "mock") {
    return new Response(null, {
      status: 302,
      headers: {
        ...BASE_HEADERS,
        Location: mockImageUrl(
          photo.id,
          watermark ? "wm" : MOCK_KIND[v],
          photo.width ?? 0,
          photo.height ?? 0,
        ),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const key = `${photo.id}/${v}`;
  // <=10 min browser staleness after a watermark toggle / re-export is accepted (PLAN 5.3).
  const cacheControl = "private, max-age=600";
  const version = sourceVersion(photo, fileId);
  const wmFlag = watermark ? "1" : "0";
  let hit = await env.CACHE.get(key);
  if (
    hit &&
    (!version ||
      hit.customMetadata?.fileId !== fileId ||
      hit.customMetadata?.wm !== wmFlag ||
      hit.customMetadata?.v !== version)
  ) {
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
  if (!hasLength || !version)
    return new Response(upstream.body, { status: 200, headers });

  headers["Content-Length"] = String(length);
  const [toClient, toCache] = upstream.body.tee();
  const fixed = new FixedLengthStream(length);
  ctx.waitUntil(
    Promise.all([
      pump(toCache, fixed.writable),
      env.CACHE.put(key, fixed.readable, {
        httpMetadata: { contentType },
        customMetadata: { fileId, wm: wmFlag, v: version },
      }),
    ]).catch(() => {
      // Caching is best-effort; the client already got the image.
    }),
  );
  return new Response(toClient, { status: 200, headers });
}
