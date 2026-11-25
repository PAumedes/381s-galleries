import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import {
  accessFingerprint,
  clientIpHash,
  crossSite,
  findGallery,
  openGallery,
  requireVisitor,
  type AccessRow,
  type GalleryRow,
  type VisitorRow,
} from "./access";
import { newId, signToken } from "./crypto";
import {
  ANON_RATE,
  createAnonVisitor,
  visibleFavoritesQuery,
} from "./favorites";
import { jsonReply } from "./http";
import { hit, retryAfterFor, type RateRule } from "./rate-limit";
import { rawUserAgent, visitorInfo } from "./visitor-info";
import {
  DL_MAX_IDS,
  DL_RATE,
  DL_TOKEN_TTL_SECONDS,
  downloadFilename,
  fileIdFor,
  isVariant,
  variantAllowed,
} from "./download-shared";
import type { DlEnv, DlToken, DlVariant, PhotoRow } from "./download-shared";

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

interface Gate {
  g: AccessRow;
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
  g: AccessRow,
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

/** The visible photos among `photoIds` of this gallery, by id. */
async function visiblePhotosById(
  env: DlEnv,
  g: GalleryRow,
  photoIds: string[],
) {
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
  return new Map(rows.map((p) => [p.id, p]));
}

interface TokenContext {
  g: AccessRow;
  visitor: VisitorRow;
  variant: DlVariant;
  pf: string;
  /** Tokens issued under the allow_bulk gate remember it, so /dl can re-check. */
  bulkTag: string | undefined;
}

/** A signed one-photo download token (never exposes Drive ids: only our own /dl/ path). */
async function issueToken(env: DlEnv, c: TokenContext, p: PhotoRow) {
  const payload: DlToken = {
    t: "dl",
    jti: newId(),
    g: c.g.id,
    p: p.id,
    v: c.variant,
    vid: c.visitor.id,
    pf: c.pf,
    ...(c.bulkTag ? { b: c.bulkTag } : {}),
  };
  const token = await signToken(
    payload,
    env.DOWNLOAD_SECRET,
    DL_TOKEN_TTL_SECONDS,
  );
  return {
    photoId: p.id,
    url: `/dl/${token}`,
    filename: downloadFilename(p.baseName, c.variant),
  };
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
  const byId = await visiblePhotosById(env, g, photoIds);
  const ctx: TokenContext = {
    g,
    visitor,
    variant,
    pf: await accessFingerprint(g, env),
    bulkTag: bulkId ?? (photoIds.length > 1 ? "multi" : undefined),
  };
  const tokens: Awaited<ReturnType<typeof issueToken>>[] = [];
  const missing: string[] = [];
  const unavailable: string[] = [];
  for (const id of photoIds) {
    const p = byId.get(id);
    if (!p) missing.push(id);
    else if (!fileIdFor(p, variant)) unavailable.push(id);
    else tokens.push(await issueToken(env, ctx, p));
  }
  return reply({ tokens, missing, unavailable }, 200, cookie);
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

export { serveDownload } from "./download-serve";
export type { DownloadDeps } from "./download-serve";
export * from "./download-shared";
