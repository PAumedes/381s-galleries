import { and, asc, eq, inArray } from "drizzle-orm";
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
  VISITOR_WINDOW_MS,
  createAnonVisitor,
  visibleFavoritesQuery,
} from "./favorites";
import { jsonReply } from "./http";
import { rateLimit, retryAfterSeconds } from "./rate-limit";

export const DL_TOKEN_TTL_SECONDS = 10 * 60;
export const DL_WINDOW_MS = 10 * 60 * 1000;
/** Token/bulk requests per ip+gallery per window (a big bulk run needs one per 50 files plus refreshes). */
export const DL_MAX_PER_WINDOW = 300;
export const DL_MAX_IDS = 50;
/** `/dl` hits per ip+gallery per window (zips with retries and refreshes). */
export const DL_GET_MAX_PER_WINDOW = 3000;
/** Uses of one download token (retries, ranges, resumes). */
export const DL_TOKEN_MAX_USES = 20;
const VARIANTS = ["highres", "web", "ig"] as const;
type DlVariant = (typeof VARIANTS)[number];
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
  typeof v === "string" && (VARIANTS as readonly string[]).includes(v);

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
    baseName
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
  const star = encodeURIComponent(filename).replace(
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
  const ipHash = await clientIpHash(request, env);
  const limitedReply = async (scope: string, windowMs: number) =>
    reply({ error: "rate_limited" }, 429, undefined, {
      "Retry-After": String(
        ipHash
          ? await retryAfterSeconds(env, scope, `${ipHash}:${g.id}`, windowMs)
          : 60,
      ),
    });
  if (
    !ipHash ||
    !(await rateLimit(
      env,
      "dl",
      `${ipHash}:${g.id}`,
      DL_MAX_PER_WINDOW,
      DL_WINDOW_MS,
    ))
  ) {
    return limitedReply("dl", DL_WINDOW_MS);
  }
  let cookie: string | undefined;
  if (!visitor) {
    const anon = await createAnonVisitor(request, env, g);
    if (!anon) return limitedReply("anon", VISITOR_WINDOW_MS);
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

  const db = getDb(env as Env);
  let bulkId: string | undefined;
  if (body.bulkId !== undefined) {
    if (typeof body.bulkId !== "string" || body.bulkId.length > 64)
      return bad();
    const [row] = await db
      .select({ id: schema.downloads.id })
      .from(schema.downloads)
      .where(
        and(
          eq(schema.downloads.id, body.bulkId),
          eq(schema.downloads.galleryId, g.id),
          eq(schema.downloads.kind, "bulk"),
        ),
      );
    if (!row) return bad();
    bulkId = row.id;
  }

  // Tokens issued under the allow_bulk gate remember it, so /dl can re-check.
  const bulkTag = bulkId ?? (photoIds.length > 1 ? "multi" : undefined);

  const rows = await db
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

export async function handleBulk(
  request: Request,
  slug: string,
  env: DlEnv,
): Promise<Response> {
  const r = await gate(request, slug, env, {
    bulk: () => true,
    valid: (b) =>
      b.scope === "all" ||
      b.scope === "favorites" ||
      (b.scope === "set" &&
        typeof b.set === "string" &&
        b.set.length > 0 &&
        b.set.length <= 200),
  });
  if (r instanceof Response) return r;
  const { g, visitor, cookie, variant, body } = r;
  const scope = body.scope;
  const set = body.set;

  const db = getDb(env as Env);
  const conds = [eq(schema.photos.galleryId, g.id), photoVisible];
  if (scope === "set") conds.push(eq(schema.photos.setName, set as string));
  let photos = await db
    .select()
    .from(schema.photos)
    .where(and(...conds))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  if (scope === "favorites") {
    const favs = new Set(
      (await visibleFavoritesQuery(db, visitor.id, g.id)).map((f) => f.id),
    );
    photos = photos.filter((p) => favs.has(p.id));
  }
  photos = photos.filter((p) => fileIdFor(p, variant));
  if (photos.length === 0) {
    return reply({ bulkId: null, photoIds: [] }, 200, cookie);
  }

  const bulkId = newId();
  await db.insert(schema.downloads).values({
    id: bulkId,
    galleryId: g.id,
    photoId: null,
    visitorId: visitor.id,
    variant,
    kind: "bulk",
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
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};
const gone = () =>
  new Response("Gone", {
    status: 410,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
const badGateway = () =>
  new Response("Bad gateway", {
    status: 502,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });

export interface DownloadDeps {
  drive: DriveClient;
}

export async function serveDownload(
  request: Request,
  token: string,
  env: DlEnv,
  deps: DownloadDeps,
): Promise<Response> {
  const claims = await verifyToken<DlToken>(token, env.DOWNLOAD_SECRET);
  if (
    !claims ||
    claims.t !== "dl" ||
    typeof claims.jti !== "string" ||
    typeof claims.g !== "string" ||
    typeof claims.p !== "string" ||
    typeof claims.pf !== "string" ||
    !isVariant(claims.v)
  ) {
    return gone();
  }
  const variant = claims.v;

  const limited = async (scope: string, key: string, windowMs: number) =>
    new Response("Too Many Requests", {
      status: 429,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": String(
          await retryAfterSeconds(env, scope, key, windowMs),
        ),
      },
    });
  const ipHash = await clientIpHash(request, env);
  if (
    ipHash &&
    !(await rateLimit(
      env,
      "dlget",
      `${ipHash}:${claims.g}`,
      DL_GET_MAX_PER_WINDOW,
      DL_WINDOW_MS,
    ))
  )
    return limited("dlget", `${ipHash}:${claims.g}`, DL_WINDOW_MS);
  const exp = (claims as { exp?: number }).exp;
  const ttlMs = Math.max(
    1000,
    typeof exp === "number"
      ? exp * 1000 - Date.now()
      : DL_TOKEN_TTL_SECONDS * 1000,
  );
  if (!(await rateLimit(env, "dlj", claims.jti, DL_TOKEN_MAX_USES, ttlMs)))
    return limited("dlj", claims.jti, ttlMs);

  const db = getDb(env as Env);
  const [row] = await db
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
  if (!row) return gone();
  const { photo, gallery } = row;
  if (!isAvailable(gallery)) return gone();
  if (claims.pf !== (await pinFingerprint(gallery.pinHash, env))) return gone();
  if (!variantAllowed(gallery, variant)) return gone();
  if (claims.b && !gallery.allowBulk) return gone();
  const fileId = fileIdFor(photo, variant);
  if (!fileId) return gone();

  const isHead = request.method === "HEAD";
  const log = async () => {
    if (isHead) return;
    const country = (request as { cf?: { country?: string } }).cf?.country;
    await db
      .insert(schema.downloads)
      .values({
        galleryId: gallery.id,
        photoId: photo.id,
        visitorId: typeof claims.vid === "string" ? claims.vid : null,
        variant,
        kind: claims.b ? "bulk" : "single",
        tokenId: claims.jti,
        country: country ?? null,
        ua: request.headers.get("User-Agent")?.slice(0, 200) ?? null,
      })
      .onConflictDoNothing();
  };

  if (env.DRIVE_MODE === "mock") {
    await log();
    return new Response(null, {
      status: 302,
      headers: {
        ...BASE_HEADERS,
        Location: mockImageUrl(
          photo.id,
          variant,
          photo.width ?? 0,
          photo.height ?? 0,
        ),
      },
    });
  }

  let upstream: Response;
  try {
    upstream = await deps.drive.streamFile(fileId, {
      range: request.headers.get("Range") ?? undefined,
    });
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return gone();
    if (err instanceof DriveError && err.status === 416) {
      return new Response(null, {
        status: 416,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    console.error(
      "dl: drive error",
      err instanceof DriveError ? err.status : "error",
    );
    return badGateway();
  }
  await log();

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
