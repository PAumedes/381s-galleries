import { and, eq, sql } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../../db";
import {
  gallerySessionCookie,
  pinFingerprint,
  readGallerySession,
  type GallerySession,
} from "./auth";
import { hashIp, newId } from "./crypto";
import { crossSite, findGallery, isAvailable, isSecure } from "./gallery";

type FavEnv = Pick<Env, "DB" | "SESSION_SECRET"> &
  Partial<Pick<Env, "DRIVE_MODE">>;

export const FAVORITES_MAX = 2000;
export const VISITOR_MAX_PER_WINDOW = 30;
export const ANON_MAX_PER_WINDOW = 20; // per IP+gallery per 10 min; venues share Wi-Fi, each device needs one
export const VISITOR_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_LIST = "Favoritos";
const ANON_DOMAIN = "@anon.invalid";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

type Gallery = typeof schema.galleries.$inferSelect;

/** Same gate as loadGallery: available and (unlocked if PIN). Otherwise null. */
async function openGallery(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<{ g: Gallery; session: GallerySession | null } | null> {
  const g = await findGallery(env, slug);
  if (!g || !isAvailable(g)) return null;
  const session = await readGallerySession(
    request,
    { id: g.id, pinHash: g.pinHash },
    env,
  );
  if (g.pinHash && !session?.unlocked) return null;
  return { g, session };
}

async function sessionWithVisitor(
  request: Request,
  g: Gallery,
  session: GallerySession | null,
  visitorId: string,
  env: FavEnv,
): Promise<string> {
  const next: GallerySession = {
    galleryId: g.id,
    unlocked: session?.unlocked ?? true,
    pf: session?.pf ?? (await pinFingerprint(g.pinHash, env)),
    visitorId,
    ...(session?.viewed ? { viewed: true } : {}),
  };
  return gallerySessionCookie(next, env, { secure: isSecure(request) });
}

async function currentVisitor(
  env: FavEnv,
  g: Gallery,
  session: GallerySession | null,
) {
  if (!session?.visitorId) return null;
  const [v] = await getDb(env as Env)
    .select()
    .from(schema.visitors)
    .where(
      and(
        eq(schema.visitors.id, session.visitorId),
        eq(schema.visitors.galleryId, g.id),
      ),
    );
  return v ?? null;
}

const isAnon = (email: string) => email.endsWith(ANON_DOMAIN);

async function hitRateLimit(env: FavEnv, key: string): Promise<number> {
  const now = nowIso();
  const cutoff = nowIso(new Date(Date.now() - VISITOR_WINDOW_MS));
  if (Math.random() < 0.01) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start <= ?1")
      .bind(cutoff)
      .run();
  }
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(key, now, cutoff)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

export async function handleVisitor(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<Response> {
  if (crossSite(request)) return reply({ error: "forbidden" }, 403);
  const open = await openGallery(request, slug, env);
  if (!open) return notFound();
  const { g, session } = open;

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
      (await hitRateLimit(env, `visitor:${ipHash}:${g.id}`)) >
      VISITOR_MAX_PER_WINDOW
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
  const cookie = await sessionWithVisitor(request, g, session, v.id, env);
  return reply(
    {
      visitor: existed ? { email: v.email } : { email: v.email, name: v.name },
    },
    200,
    cookie,
  );
}

async function clientIpHash(request: Request, env: FavEnv) {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    (env.DRIVE_MODE === "mock" ? "local" : null);
  return ip ? hashIp(ip, env.SESSION_SECRET) : null;
}

export async function handleListFavorites(
  request: Request,
  slug: string,
  env: FavEnv,
): Promise<Response> {
  const open = await openGallery(request, slug, env);
  if (!open) return notFound();
  const { g, session } = open;
  const v = await currentVisitor(env, g, session);
  if (!v) return reply({ visitor: null, favorites: [] });
  const rows = await getDb(env as Env)
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
        eq(schema.favorites.visitorId, v.id),
        eq(schema.favorites.galleryId, g.id),
        eq(schema.favorites.listName, DEFAULT_LIST),
        photoVisible,
      ),
    )
    .orderBy(schema.favorites.createdAt);
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
  const open = await openGallery(request, slug, env);
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
  let v = await currentVisitor(env, g, session);
  let cookie: string | undefined;
  if (g.requireEmail && (!v || isAnon(v.email))) {
    return reply({ error: "email_required" }, 403);
  }
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
      (await hitRateLimit(env, `anon:${ipHash}:${g.id}`)) > ANON_MAX_PER_WINDOW
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
    cookie = await sessionWithVisitor(request, g, session, id, env);
  }

  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO favorites (gallery_id, visitor_id, photo_id, list_name)
     SELECT ?1, ?2, ?3, ?4
     WHERE (SELECT COUNT(*) FROM favorites f
              JOIN photos p ON p.gallery_id = f.gallery_id AND p.id = f.photo_id
             WHERE f.visitor_id = ?2 AND p.missing_since IS NULL) < ?5`,
  )
    .bind(g.id, v.id, photo.id, DEFAULT_LIST, FAVORITES_MAX)
    .run();
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
