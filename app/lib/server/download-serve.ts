import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import {
  accessFingerprint,
  accessSelect,
  clientIpHash,
  isAvailable,
  withClientPin,
} from "./access";
import { verifyToken } from "./crypto";
import { mockImageUrl } from "./drive-mock";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";
import {
  contentDisposition,
  DL_GET_RATE,
  DL_TOKEN_RATE,
  DL_TOKEN_TTL_SECONDS,
  downloadFilename,
  fileIdFor,
  isTiffDownload,
  isVariant,
  variantAllowed,
} from "./download-shared";
import type { DlEnv, DlToken, DlVariant, PhotoRow } from "./download-shared";
import { NOSNIFF, PRIVATE_NO_STORE, textResponse } from "./http";
import { hit, retryAfterFor, type RateRule } from "./rate-limit";
import { TIFF_MIME } from "./tiff";
import { rawUserAgent, visitorInfo } from "./visitor-info";

// ------------------------------------------------------------------ /dl/:token

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BASE_HEADERS = {
  ...NOSNIFF,
  "Referrer-Policy": "no-referrer",
  "Cache-Control": PRIVATE_NO_STORE,
};
const gone = () => textResponse("Gone", 410, BASE_HEADERS);
const badGateway = () => textResponse("Bad gateway", 502, BASE_HEADERS);

/**
 * Failures of a TIFF download (T6.53d) answer in plain words, Spanish then
 * English, with a retry hint and nothing about Drive (no ids, no upstream
 * text). `busy` = Drive quota / rate limit (403, 429): worth waiting longer.
 */
const TIFF_RETRY_SECONDS = { busy: 300, failed: 60 };
const TIFF_MESSAGES = {
  gone: "Este archivo ya no está disponible.\nThis file is no longer available.",
  busy: "El archivo no se pudo descargar ahora (demasiadas descargas). Probá de nuevo en unos minutos.\nThe file could not be downloaded right now (too many downloads). Try again in a few minutes.",
  failed:
    "El archivo no se pudo descargar. Probá de nuevo en un minuto.\nThe file could not be downloaded. Try again in a minute.",
};
function tiffFailure(kind: keyof typeof TIFF_MESSAGES): Response {
  if (kind === "gone")
    return textResponse(TIFF_MESSAGES.gone, 410, BASE_HEADERS);
  return textResponse(TIFF_MESSAGES[kind], kind === "busy" ? 503 : 502, {
    ...BASE_HEADERS,
    "Retry-After": String(TIFF_RETRY_SECONDS[kind]),
  });
}

export interface DownloadDeps {
  drive: DriveClient;
}

/** The signed token's claims, or null when forged, expired or malformed. */
async function verifyDownloadToken(
  token: string,
  env: DlEnv,
): Promise<DlToken | null> {
  const claims = await verifyToken<DlToken>(token, env.DOWNLOAD_SECRET);
  if (
    !claims ||
    claims.t !== "dl" ||
    typeof claims.jti !== "string" ||
    typeof claims.g !== "string" ||
    typeof claims.p !== "string" ||
    typeof claims.pf !== "string" ||
    !isVariant(claims.v)
  )
    return null;
  return claims;
}

/** 429 when the IP or the token itself has used up its allowance; null otherwise. */
async function downloadRateLimited(
  request: Request,
  env: DlEnv,
  claims: DlToken,
): Promise<Response | null> {
  const limited = async (rule: RateRule, key: string, windowMs?: number) =>
    textResponse("Too Many Requests", 429, {
      ...BASE_HEADERS,
      "Retry-After": String(await retryAfterFor(env, rule, key, windowMs)),
    });
  const ipHash = await clientIpHash(request, env, { prefix64: true });
  if (ipHash && !(await hit(env, DL_GET_RATE, `${ipHash}:${claims.g}`)))
    return limited(DL_GET_RATE, `${ipHash}:${claims.g}`);
  const exp = (claims as { exp?: number }).exp;
  const ttlMs = Math.max(
    1000,
    typeof exp === "number"
      ? exp * 1000 - Date.now()
      : DL_TOKEN_TTL_SECONDS * 1000,
  );
  if (!(await hit(env, DL_TOKEN_RATE, claims.jti, ttlMs)))
    return limited(DL_TOKEN_RATE, claims.jti, ttlMs);
  return null;
}

/** The photo, gallery and Drive file a token still entitles to; null = gone. */
async function loadDownloadTarget(env: DlEnv, claims: DlToken) {
  const [row] = await getDb(env as Env)
    .select({ photo: schema.photos, ...accessSelect })
    .from(schema.photos)
    .innerJoin(
      schema.galleries,
      eq(schema.galleries.id, schema.photos.galleryId),
    )
    .leftJoin(schema.clients, eq(schema.galleries.clientId, schema.clients.id))
    .where(
      and(
        eq(schema.photos.id, claims.p),
        eq(schema.photos.galleryId, claims.g),
        photoVisible,
      ),
    );
  if (!row) return null;
  const { photo } = row;
  const gallery = withClientPin(row);
  if (!isAvailable(gallery)) return null;
  if (claims.pf !== (await accessFingerprint(gallery, env))) return null;
  if (!variantAllowed(gallery, claims.v)) return null;
  if (claims.b && !gallery.allowBulk) return null;
  // A TIFF is one file at a time, never part of a multi-photo / bulk run.
  if (claims.b && isTiffDownload(photo, claims.v)) return null;
  const fileId = fileIdFor(photo, claims.v);
  return fileId ? { photo, gallery, fileId } : null;
}

async function logDownload(
  request: Request,
  env: DlEnv,
  claims: DlToken,
  photo: PhotoRow,
  galleryId: string,
): Promise<void> {
  const info = await visitorInfo(request, env, galleryId);
  await getDb(env as Env)
    .insert(schema.downloads)
    .values({
      galleryId,
      photoId: photo.id,
      visitorId: typeof claims.vid === "string" ? claims.vid : null,
      variant: claims.v,
      kind: claims.b ? "bulk" : "single",
      tokenId: claims.jti,
      bulkId: claims.b && claims.b !== "multi" ? claims.b : null,
      ...info,
      ua: rawUserAgent(request),
    })
    .onConflictDoNothing();
}

/** Drive stream (Range forwarded), or the error response (gone / 416 / 502). */
async function fetchDownloadUpstream(
  drive: DriveClient,
  fileId: string,
  range: string | null,
  tiff: boolean,
): Promise<{ upstream: Response } | { error: Response }> {
  try {
    return {
      upstream: await drive.streamFile(fileId, { range: range ?? undefined }),
    };
  } catch (err) {
    if (err instanceof DriveError && err.status === 404)
      return { error: tiff ? tiffFailure("gone") : gone() };
    if (err instanceof DriveError && err.status === 416) {
      return {
        error: new Response(null, {
          status: 416,
          headers: { "Cache-Control": PRIVATE_NO_STORE },
        }),
      };
    }
    const status = err instanceof DriveError ? err.status : "error";
    console.error("dl: drive error", status);
    if (!tiff) return { error: badGateway() };
    return {
      error: tiffFailure(status === 403 || status === 429 ? "busy" : "failed"),
    };
  }
}

/** Drive answered HTML / JSON where the file's bytes belong. */
const isWebPage = (upstream: Response): boolean =>
  /^(text\/html|application\/json)/i.test(
    upstream.headers.get("Content-Type") ?? "",
  );

/** Attachment response mirroring the upstream status, length and range headers. */
async function attachmentResponse(
  upstream: Response,
  photo: PhotoRow,
  variant: DlVariant,
  isHead: boolean,
): Promise<Response> {
  const tiff = isTiffDownload(photo, variant);
  const type = (upstream.headers.get("Content-Type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const headers = new Headers({
    ...BASE_HEADERS,
    // Drive often labels a TIFF application/octet-stream: it is a TIFF.
    "Content-Type": tiff
      ? TIFF_MIME
      : IMAGE_TYPES.includes(type)
        ? type
        : "image/jpeg",
    "Content-Disposition": contentDisposition(
      downloadFilename(photo.baseName, variant, tiff),
    ),
  });
  for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (isHead) {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function serveDownload(
  request: Request,
  token: string,
  env: DlEnv,
  deps: DownloadDeps,
): Promise<Response> {
  const claims = await verifyDownloadToken(token, env);
  if (!claims) return gone();
  const limited = await downloadRateLimited(request, env, claims);
  if (limited) return limited;
  const target = await loadDownloadTarget(env, claims);
  if (!target) return gone();
  const { photo, gallery, fileId } = target;

  const isHead = request.method === "HEAD";
  const log = () =>
    isHead
      ? Promise.resolve()
      : logDownload(request, env, claims, photo, gallery.id);

  if (env.DRIVE_MODE === "mock") {
    await log();
    return new Response(null, {
      status: 302,
      headers: {
        ...BASE_HEADERS,
        Location: mockImageUrl(
          photo.id,
          claims.v,
          photo.width ?? 0,
          photo.height ?? 0,
        ),
      },
    });
  }

  const tiff = isTiffDownload(photo, claims.v);
  const fetched = await fetchDownloadUpstream(
    deps.drive,
    fileId,
    request.headers.get("Range"),
    tiff,
  );
  if ("error" in fetched) return fetched.error;
  if (tiff && isWebPage(fetched.upstream)) {
    // A page instead of the file (e.g. Drive's "too large to scan" notice).
    console.error("dl: drive answered a web page instead of the file");
    await fetched.upstream.body?.cancel();
    return tiffFailure("failed");
  }
  await log();
  return attachmentResponse(fetched.upstream, photo, claims.v, isHead);
}
