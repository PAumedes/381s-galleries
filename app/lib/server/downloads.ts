import { DOWNLOAD_SIZES, type DownloadSize } from "../constants";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { wellFormed } from "../text";
import { getDb, photoVisible, schema } from "../../db";
import {
  clientIpHash,
  crossSite,
  findGallery,
  isAvailable,
  openGallery,
  requireVisitor,
  type AccessEnv,
  type GalleryRow,
  type VisitorRow,
} from "./access";
import { pinFingerprint } from "./auth";
import { newId, signToken, verifyToken } from "./crypto";
import { mockImageUrl } from "./drive-mock";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";
import {
  ANON_RATE,
  createAnonVisitor,
  visibleFavoritesQuery,
} from "./favorites";
import { jsonReply, NOSNIFF, PRIVATE_NO_STORE, textResponse } from "./http";
import { hit, retryAfterFor, type RateRule } from "./rate-limit";
import { rawUserAgent, visitorInfo } from "./visitor-info";

export const DL_TOKEN_TTL_SECONDS = 10 * 60;
export const DL_WINDOW_MS = 10 * 60 * 1000;
/** Token/bulk requests per ip+gallery per window (a big bulk run needs one per 50 files plus refreshes). */
export const DL_MAX_PER_WINDOW = 300;
export const DL_MAX_IDS = 50;
/** `/dl` hits per ip+gallery per window (zips with retries and refreshes). */
export const DL_GET_MAX_PER_WINDOW = 3000;
/** Uses of one download token (retries, ranges, resumes). */
export const DL_TOKEN_MAX_USES = 20;
/** Token/bulk requests per ip+gallery. */
const DL_RATE: RateRule = {
  scope: "dl",
  max: DL_MAX_PER_WINDOW,
  windowMs: DL_WINDOW_MS,
};
/** `/dl` hits per ip+gallery. */
const DL_GET_RATE: RateRule = {
  scope: "dlget",
  max: DL_GET_MAX_PER_WINDOW,
  windowMs: DL_WINDOW_MS,
};
/** Uses of one token (window = the token's remaining TTL, set per hit). */
const DL_TOKEN_RATE: RateRule = {
  scope: "dlj",
  max: DL_TOKEN_MAX_USES,
  windowMs: DL_TOKEN_TTL_SECONDS * 1000,
};
type DlVariant = DownloadSize;
type PhotoRow = typeof schema.photos.$inferSelect;
type DlEnv = AccessEnv & Pick<Env, "DOWNLOAD_SECRET">;

interface DlToken {
  t: "dl";
  jti: string;
  g: string;
  p: string;
  v: DlVariant;
  vid: string;
  pf: string;
  b?: string;
}

const isVariant = (v: unknown): v is DlVariant =>
  typeof v === "string" && (DOWNLOAD_SIZES as readonly string[]).includes(v);

const reply = jsonReply;
const notFound = () => reply({ error: "not_found" }, 404);
const bad = () => reply({ error: "bad_request" }, 400);

async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json();
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function variantAllowed(g: GalleryRow, v: DlVariant): boolean {
  // Proofing (Prueba): nothing is downloadable, whatever the allow_* flags say.
  if (g.mode === "proofing") return false;
  return v === "highres"
    ? g.allowHighres
    : v === "web"
      ? g.allowWeb
      : g.allowIg;
}

function fileIdFor(p: PhotoRow, v: DlVariant): string | null {
  return (
    (v === "highres"
      ? p.driveHighresId
      : v === "web"
        ? p.driveWebId
        : p.driveIgId) || null
  );
}

/** Download file name: no path separators / control chars (unicode kept). */
export function downloadFilename(baseName: string, v: DlVariant): string {
  const base =
    wellFormed(baseName)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f/\\]/g, "")
      .trim()
      // Truncate by code point so an astral character is never split.
      .match(/[\s\S]/gu)
      ?.slice(0, 200)
      .join("") || "photo";
  return `${base}${v === "highres" ? "" : `-${v}`}.jpg`;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const star = encodeURIComponent(wellFormed(filename)).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

interface Gate {
  g: GalleryRow;
  visitor: VisitorRow;
  cookie?: string;
  variant: DlVariant;
  body: Record<string, unknown>;
}

/**
 * Gates shared by the token and bulk endpoints: CSRF, gallery access, body,
 * email gate, variant/bulk flags, `dl:` rate limit, then the (anonymous) visitor.
 */
async function gate(
  request: Request,
  slug: string,
  env: DlEnv,
  opts: {
    bulk: (body: Record<string, unknown>) => boolean;
    valid: (body: Record<string, unknown>) => boolean;
  },
): Promise<Gate | Response> {
  if (crossSite(request)) return reply({ error: "forbidden" }, 403);
  const open = await openGallery(request, await findGallery(env, slug), env);
  if (!open) return notFound();
  const { g, session } = open;
  if (g.mode === "proofing") return reply({ error: "proofing" }, 403);
  const body = await readJson(request);
  if (!body || !isVariant(body.variant)) return bad();
  const variant = body.variant;

  const vg = await requireVisitor(env, g, session);
  if (vg.error) return reply({ error: vg.error }, 403);
  if (!variantAllowed(g, variant)) {
    return reply({ error: "variant_disabled" }, 403);
  }
  if (opts.bulk(body) && !g.allowBulk)
    return reply({ error: "bulk_disabled" }, 403);
  if (!opts.valid(body)) return bad();
  return finishGate(request, env, g, vg.visitor, variant, body);
}

async function finishGate(
  request: Request,
  env: DlEnv,
  g: GalleryRow,
  visitor: VisitorRow | null,
  variant: DlVariant,
  body: Record<string, unknown>,
): Promise<Gate | Response> {
  const ipHash = await clientIpHash(request, env, { prefix64: true });
  const limitedReply = async (rule: RateRule) =>
    reply({ error: "rate_limited" }, 429, undefined, {
      "Retry-After": String(
        ipHash ? await retryAfterFor(env, rule, `${ipHash}:${g.id}`) : 60,
      ),
    });
  if (!ipHash || !(await hit(env, DL_RATE, `${ipHash}:${g.id}`))) {
    return limitedReply(DL_RATE);
  }
  let cookie: string | undefined;
  if (!visitor) {
    const anon = await createAnonVisitor(request, env, g);
    if (!anon) return limitedReply(ANON_RATE);
    visitor = anon.visitor;
    cookie = anon.cookie;
  }
  return { g, visitor, cookie, variant, body };
}

function parseIds(ids: unknown): string[] | null {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > DL_MAX_IDS ||
    !ids.every(
      (i) => typeof i === "string" && i.length > 0 && i.length <= 128,
    ) ||
    new Set(ids).size !== ids.length
  ) {
    return null;
  }
  return ids as string[];
}

/** The caller's own bulk request named by `bulkId`, or null (also when the id is malformed). */
async function ownBulkId(
  env: DlEnv,
  g: GalleryRow,
  visitor: VisitorRow,
  bulkId: unknown,
): Promise<string | null> {
  if (typeof bulkId !== "string" || bulkId.length > 64) return null;
  const [row] = await getDb(env as Env)
    .select({ id: schema.downloads.id })
    .from(schema.downloads)
    .where(
      and(
        eq(schema.downloads.id, bulkId),
        eq(schema.downloads.galleryId, g.id),
        eq(schema.downloads.kind, "bulk"),
        isNull(schema.downloads.photoId),
        eq(schema.downloads.visitorId, visitor.id),
      ),
    );
  return row?.id ?? null;
}

export async function handleDownloadTokens(
  request: Request,
  slug: string,
  env: DlEnv,
): Promise<Response> {
  const r = await gate(request, slug, env, {
    bulk: (b) =>
      (Array.isArray(b.photoIds) && b.photoIds.length > 1) ||
      b.bulkId !== undefined,
    valid: (b) => parseIds(b.photoIds) !== null,
  });
  if (r instanceof Response) return r;
  const { g, visitor, cookie, variant, body } = r;

  const photoIds = parseIds(body.photoIds) as string[];

  let bulkId: string | undefined;
  if (body.bulkId !== undefined) {
    const own = await ownBulkId(env, g, visitor, body.bulkId);
    if (!own) return bad();
    bulkId = own;
  }
  // Tokens issued under the allow_bulk gate remember it, so /dl can re-check.
  const bulkTag = bulkId ?? (photoIds.length > 1 ? "multi" : undefined);

  const rows = await getDb(env as Env)
    .select()
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.galleryId, g.id),
        inArray(schema.photos.id, photoIds),
        photoVisible,
      ),
    );
  const byId = new Map(rows.map((p) => [p.id, p]));
  const pf = await pinFingerprint(g.pinHash, env);
  const out: { photoId: string; url: string; filename: string }[] = [];
  const missing: string[] = [];
  const unavailable: string[] = [];
  for (const id of photoIds) {
    const p = byId.get(id);
    if (!p) missing.push(id);
    else if (!fileIdFor(p, variant)) unavailable.push(id);
    else {
      const payload: DlToken = {
        t: "dl",
        jti: newId(),
        g: g.id,
        p: p.id,
        v: variant,
        vid: visitor.id,
        pf,
        ...(bulkTag ? { b: bulkTag } : {}),
      };
      const token = await signToken(
        payload,
        env.DOWNLOAD_SECRET,
        DL_TOKEN_TTL_SECONDS,
      );
      out.push({
        photoId: p.id,
        url: `/dl/${token}`,
        filename: downloadFilename(p.baseName, variant),
      });
    }
  }
  return reply({ tokens: out, missing, unavailable }, 200, cookie);
}

const isBulkScope = (b: Record<string, unknown>) =>
  b.scope === "all" ||
  b.scope === "favorites" ||
  (b.scope === "set" &&
    typeof b.set === "string" &&
    b.set.length > 0 &&
    b.set.length <= 200);

/** The visible photos of the requested scope that have a file for `variant`, in gallery order. */
async function bulkPhotos(
  env: DlEnv,
  g: GalleryRow,
  visitor: VisitorRow,
  variant: DlVariant,
  body: Record<string, unknown>,
): Promise<PhotoRow[]> {
  const db = getDb(env as Env);
  const conds = [eq(schema.photos.galleryId, g.id), photoVisible];
  if (body.scope === "set")
    conds.push(eq(schema.photos.setName, body.set as string));
  let photos = await db
    .select()
    .from(schema.photos)
    .where(and(...conds))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  if (body.scope === "favorites") {
    const favs = new Set(
      (await visibleFavoritesQuery(db, visitor.id, g.id)).map((f) => f.id),
    );
    photos = photos.filter((p) => favs.has(p.id));
  }
  return photos.filter((p) => fileIdFor(p, variant));
}

export async function handleBulk(
  request: Request,
  slug: string,
  env: DlEnv,
): Promise<Response> {
  const r = await gate(request, slug, env, {
    bulk: () => true,
    valid: isBulkScope,
  });
  if (r instanceof Response) return r;
  const { g, visitor, cookie, variant, body } = r;
  const scope = body.scope as string;

  const photos = await bulkPhotos(env, g, visitor, variant, body);
  if (photos.length === 0) {
    return reply({ bulkId: null, photoIds: [] }, 200, cookie);
  }

  const bulkId = newId();
  await getDb(env as Env)
    .insert(schema.downloads)
    .values({
      id: bulkId,
      galleryId: g.id,
      photoId: null,
      visitorId: visitor.id,
      variant,
      kind: "bulk",
      ...(await visitorInfo(request, env, g.id)),
      ua: rawUserAgent(request),
      bulkScope:
        scope === "set"
          ? `set:${photos[0].setName ?? (body.set as string)}`
          : scope,
    });
  const totalBytes =
    variant === "highres"
      ? photos.reduce((n, p) => n + (p.highresBytes ?? 0), 0)
      : undefined;
  return reply(
    {
      bulkId,
      photoIds: photos.map((p) => p.id),
      ...(totalBytes !== undefined ? { totalBytes } : {}),
    },
    200,
    cookie,
  );
}

// ------------------------------------------------------------------ /dl/:token

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BASE_HEADERS = {
  ...NOSNIFF,
  "Referrer-Policy": "no-referrer",
  "Cache-Control": PRIVATE_NO_STORE,
};
const gone = () => textResponse("Gone", 410, BASE_HEADERS);
const badGateway = () => textResponse("Bad gateway", 502, BASE_HEADERS);

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
    .select({ photo: schema.photos, gallery: schema.galleries })
    .from(schema.photos)
    .innerJoin(
      schema.galleries,
      eq(schema.galleries.id, schema.photos.galleryId),
    )
    .where(
      and(
        eq(schema.photos.id, claims.p),
        eq(schema.photos.galleryId, claims.g),
        photoVisible,
      ),
    );
  if (!row) return null;
  const { photo, gallery } = row;
  if (!isAvailable(gallery)) return null;
  if (claims.pf !== (await pinFingerprint(gallery.pinHash, env))) return null;
  if (!variantAllowed(gallery, claims.v)) return null;
  if (claims.b && !gallery.allowBulk) return null;
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
): Promise<{ upstream: Response } | { error: Response }> {
  try {
    return {
      upstream: await drive.streamFile(fileId, { range: range ?? undefined }),
    };
  } catch (err) {
    if (err instanceof DriveError && err.status === 404)
      return { error: gone() };
    if (err instanceof DriveError && err.status === 416) {
      return {
        error: new Response(null, {
          status: 416,
          headers: { "Cache-Control": PRIVATE_NO_STORE },
        }),
      };
    }
    console.error(
      "dl: drive error",
      err instanceof DriveError ? err.status : "error",
    );
    return { error: badGateway() };
  }
}

/** Attachment response mirroring the upstream status, length and range headers. */
async function attachmentResponse(
  upstream: Response,
  photo: PhotoRow,
  variant: DlVariant,
  isHead: boolean,
): Promise<Response> {
  const type = (upstream.headers.get("Content-Type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const headers = new Headers({
    ...BASE_HEADERS,
    "Content-Type": IMAGE_TYPES.includes(type) ? type : "image/jpeg",
    "Content-Disposition": contentDisposition(
      downloadFilename(photo.baseName, variant),
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

  const fetched = await fetchDownloadUpstream(
    deps.drive,
    fileId,
    request.headers.get("Range"),
  );
  if ("error" in fetched) return fetched.error;
  await log();
  return attachmentResponse(fetched.upstream, photo, claims.v, isHead);
}
