/**
 * Approvals of retouched versions (T6.53f). One visitor (the anonymous or
 * email visitor of favorites; no accounts) approves or un-approves ONE version
 * of ONE photo: the version the gallery SHOWS now. A new version has no
 * approval ("a revisar"); nothing here gates a download. Same rules as
 * favorites: same-origin only, the shared gallery gate (published, not
 * expired, PIN session), the email gate, and the per-IP limiter that caps
 * anonymous visitors. Only albums with `versioning = 1` have approvals.
 */
import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import {
  crossSite,
  requireVisitor,
  type GalleryRow,
  type VisitorRow,
} from "./access";
import { APPROVALS_MAX } from "./approvals-list";
import {
  createAnonVisitor,
  openBySlug,
  readJson,
  type FavEnv,
} from "./favorites";
import { jsonReply } from "./http";
import { chooseVersion, loadVersionsOf, trusted } from "./photo-versions";

const reply = jsonReply;
const notFound = () => reply({ error: "not_found" }, 404);
const MAX_VERSION = 999;

/** The `{ photoId, version, on }` of a request, or null when malformed. */
function parseSetApproval(body: Record<string, unknown> | null) {
  const photoId = body?.photoId;
  const version = body?.version;
  const on = body?.on;
  if (
    typeof photoId !== "string" ||
    photoId.length === 0 ||
    photoId.length > 128 ||
    typeof on !== "boolean" ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > MAX_VERSION
  )
    return null;
  return { photoId, version, on };
}

/** The version of a photo the gallery shows now (what a visitor may approve); undefined when none. */
async function shownVersion(env: FavEnv, g: GalleryRow, photoId: string) {
  const [photo] = await getDb(env as Env)
    .select()
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, photoId),
        eq(schema.photos.galleryId, g.id),
        photoVisible,
      ),
    );
  if (!photo) return "no_photo" as const;
  const live = (await loadVersionsOf(env as Env, [photoId])).get(photoId);
  return (
    chooseVersion(trusted(photo, live), g.mode === "proofing")?.version ??
    ("no_version" as const)
  );
}

async function removeApproval(
  env: FavEnv,
  g: GalleryRow,
  visitor: VisitorRow,
  photoId: string,
  version: number,
) {
  await env.DB.prepare(
    "DELETE FROM photo_approvals WHERE visitor_id = ?1 AND photo_id = ?2 AND version = ?3 AND gallery_id = ?4",
  )
    .bind(visitor.id, photoId, version, g.id)
    .run();
}

/**
 * Adds an approval, enforcing APPROVALS_MAX in the same statement. Returns
 * "ok", "limit", or "gone" when the version row vanished meanwhile (FK).
 */
async function insertApproval(
  env: FavEnv,
  g: GalleryRow,
  visitor: VisitorRow,
  photoId: string,
  version: number,
): Promise<"ok" | "limit" | "gone"> {
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO photo_approvals (gallery_id, photo_id, version, visitor_id)
       SELECT ?1, ?2, ?3, ?4
       WHERE (SELECT COUNT(*) FROM photo_approvals WHERE gallery_id = ?1 AND visitor_id = ?4) < ?5`,
    )
      .bind(g.id, photoId, version, visitor.id, APPROVALS_MAX)
      .run();
    if (res.meta.changes !== 0) return "ok";
    const have = await env.DB.prepare(
      "SELECT 1 AS x FROM photo_approvals WHERE visitor_id = ?1 AND photo_id = ?2 AND version = ?3",
    )
      .bind(visitor.id, photoId, version)
      .first();
    return have ? "ok" : "limit";
  } catch {
    return "gone";
  }
}

export async function handleSetApproval(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<Response> {
  if (crossSite(request)) return reply({ error: "forbidden" }, 403);
  const open = await openBySlug(request, slug, env);
  if (!open || !open.g.versioning) return notFound();
  const { g, session } = open;

  const req = parseSetApproval(await readJson(request));
  if (!req) return reply({ error: "bad_request" }, 400);
  const { photoId, version, on } = req;

  const gate = await requireVisitor(env, g, session);
  if (gate.error) return reply({ error: gate.error }, 403);
  if (!on) {
    if (gate.visitor)
      await removeApproval(env, g, gate.visitor, photoId, version);
    return reply({ ok: true });
  }

  const shown = await shownVersion(env, g, photoId);
  if (shown === "no_photo") return notFound();
  if (shown === "no_version") return reply({ error: "unavailable" }, 409);
  if (shown !== version) return reply({ error: "stale" }, 409);

  let visitor = gate.visitor;
  let cookie: string | undefined;
  if (!visitor) {
    const anon = await createAnonVisitor(request, env, g);
    if (!anon) return reply({ error: "rate_limited" }, 429);
    visitor = anon.visitor;
    cookie = anon.cookie;
  }
  const done = await insertApproval(env, g, visitor, photoId, version);
  if (done === "limit") return reply({ error: "limit" }, 409, cookie);
  if (done === "gone") return reply({ error: "stale" }, 409, cookie);
  return reply({ ok: true }, 200, cookie);
}
