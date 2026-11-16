import { and, eq, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import { updateSession } from "./auth";
import { newId } from "./crypto";
import { EMAIL_RE } from "../email";
import {
  ANON_DOMAIN,
  clientIpHash,
  crossSite,
  findGallery,
  isAnon,
  openGallery,
  requireVisitor,
  type AccessEnv,
} from "./access";
import { rateLimit } from "./rate-limit";

type FavEnv = AccessEnv;

export const FAVORITES_MAX = 2000;
export const VISITOR_MAX_PER_WINDOW = 30;
export const ANON_MAX_PER_WINDOW = 20; // per IP+gallery per 10 min; venues share Wi-Fi, each device needs one
export const VISITOR_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_LIST = "Favoritos";
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

const JSON_HEADERS = { "Cache-Control": "no-store" };

function reply(
  body: unknown,
  status = 200,
  cookie?: string,
  extra: Record<string, string> = {},
): Response {
  const h = new Headers({ ...JSON_HEADERS, ...extra });
  h.set("Content-Type", "application/json");
  if (cookie) h.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers: h });
}
const notFound = () => reply({ error: "not_found" }, 404);
const bad = () => reply({ error: "bad_request" }, 400);

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  if (e.split("@")[0].length > 64) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(e)) return null;
  if (e.endsWith(ANON_DOMAIN)) return null;
  return e;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const n = v.replace(CONTROL_RE, "").trim().slice(0, 80);
  return n || null;
}

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

/** Gallery by slug through the shared gate (available + PIN session). */
async function openBySlug(request: Request, slug: string, env: FavEnv) {
  return openGallery(request, await findGallery(env, slug), env);
}

/**
 * The visitor's visible favourites (default list, visible photos only), as
 * `{ id }` rows. Shared by the list endpoint and the favourites cap so both
 * count exactly the same set. Callers add ordering.
 */
export function visibleFavoritesQuery(
  db: ReturnType<typeof getDb>,
  visitorId: string,
  galleryId: string,
) {
  return db
    .select({ id: schema.favorites.photoId })
    .from(schema.favorites)
    .innerJoin(
      schema.photos,
      and(
        eq(schema.photos.galleryId, schema.favorites.galleryId),
        eq(schema.photos.id, schema.favorites.photoId),
      ),
    )
    .where(
      and(
        eq(schema.favorites.visitorId, visitorId),
        eq(schema.favorites.galleryId, galleryId),
        eq(schema.favorites.listName, DEFAULT_LIST),
        photoVisible,
      ),
    );
}

export async function handleVisitor(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<Response> {
  if (crossSite(request)) return reply({ error: "forbidden" }, 403);
  const open = await openBySlug(request, slug, env);
  if (!open) return notFound();
  const { g } = open;

  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  if (!body || !email) return bad();
  const name = cleanName(body.name);

  const db = getDb(env as Env);
  const findByEmail = async () =>
    (
      await db
        .select()
        .from(schema.visitors)
        .where(
          and(
            eq(schema.visitors.galleryId, g.id),
            sql`${schema.visitors.email} = ${email} COLLATE NOCASE`,
          ),
        )
    )[0];

  let v = await findByEmail();
  const existed = !!v;
  if (!v) {
    const ipHash = await clientIpHash(request, env);
    if (!ipHash) return reply({ error: "rate_limited" }, 429);
    if (
      !(await rateLimit(
        env,
        "visitor",
        `${ipHash}:${g.id}`,
        VISITOR_MAX_PER_WINDOW,
        VISITOR_WINDOW_MS,
      ))
    ) {
      return reply({ error: "rate_limited" }, 429);
    }
    await db
      .insert(schema.visitors)
      .values({ id: newId(), galleryId: g.id, email, name })
      .onConflictDoNothing();
    v = await findByEmail();
  }
  if (!v) return reply({ error: "server_error" }, 500);
  const cookie = await updateSession(request, g, { visitorId: v.id }, env);
  return reply(
    {
      visitor: existed ? { email: v.email } : { email: v.email, name: v.name },
    },
    200,
    cookie,
  );
}

export async function handleListFavorites(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<Response> {
  const open = await openBySlug(request, slug, env);
  if (!open) return notFound();
  const { g, session } = open;
  const { visitor: v } = await requireVisitor(env, g, session);
  if (!v) return reply({ visitor: null, favorites: [] });
  const rows = await visibleFavoritesQuery(
    getDb(env as Env),
    v.id,
    g.id,
  ).orderBy(schema.favorites.createdAt);
  return reply({
    visitor: isAnon(v.email) ? null : { email: v.email, name: v.name },
    favorites: rows.map((r) => r.id),
  });
}

export async function handleSetFavorite(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<Response> {
  if (crossSite(request)) return reply({ error: "forbidden" }, 403);
  const open = await openBySlug(request, slug, env);
  if (!open) return notFound();
  const { g, session } = open;

  const body = await readJson(request);
  const photoId = body?.photoId;
  const on = body?.on;
  if (
    typeof photoId !== "string" ||
    photoId.length === 0 ||
    photoId.length > 128 ||
    typeof on !== "boolean"
  ) {
    return bad();
  }

  const db = getDb(env as Env);
  const gate = await requireVisitor(env, g, session);
  if (gate.error) return reply({ error: gate.error }, 403);
  let v = gate.visitor;
  let cookie: string | undefined;
  if (!v && !on) return reply({ ok: true }); // nothing to remove

  if (!on && v) {
    await env.DB.prepare(
      "DELETE FROM favorites WHERE visitor_id = ?1 AND photo_id = ?2 AND gallery_id = ?3 AND list_name = ?4",
    )
      .bind(v.id, photoId, g.id, DEFAULT_LIST)
      .run();
    return reply({ ok: true });
  }

  const [photo] = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, photoId),
        eq(schema.photos.galleryId, g.id),
        photoVisible,
      ),
    );
  if (!photo) return notFound();

  if (!v) {
    const ipHash = await clientIpHash(request, env);
    if (!ipHash) return reply({ error: "rate_limited" }, 429);
    if (
      !(await rateLimit(
        env,
        "anon",
        `${ipHash}:${g.id}`,
        ANON_MAX_PER_WINDOW,
        VISITOR_WINDOW_MS,
      ))
    ) {
      return reply({ error: "rate_limited" }, 429);
    }
    const id = newId();
    await db.insert(schema.visitors).values({
      id,
      galleryId: g.id,
      email: `anon-${crypto.randomUUID()}${ANON_DOMAIN}`,
      name: null,
    });
    v = (
      await db.select().from(schema.visitors).where(eq(schema.visitors.id, id))
    )[0];
    cookie = await updateSession(request, g, { visitorId: id }, env);
  }

  const res = await db.run(
    sql`INSERT OR IGNORE INTO favorites (gallery_id, visitor_id, photo_id, list_name)
     SELECT ${g.id}, ${v.id}, ${photo.id}, ${DEFAULT_LIST}
     WHERE (SELECT COUNT(*) FROM (${visibleFavoritesQuery(db, v.id, g.id)})) < ${FAVORITES_MAX}`,
  );
  if (res.meta.changes === 0) {
    const exists = await env.DB.prepare(
      "SELECT 1 AS x FROM favorites WHERE visitor_id = ?1 AND photo_id = ?2 AND list_name = ?3",
    )
      .bind(v.id, photo.id, DEFAULT_LIST)
      .first();
    if (!exists) return reply({ error: "limit" }, 409, cookie);
  }
  return reply({ ok: true }, 200, cookie);
}
