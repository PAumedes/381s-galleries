import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../../db";
import type { OpenGallery } from "../../components/types";
import type { GalleryPhoto } from "../../components/types";
import {
  gallerySessionCookie,
  pinFingerprint,
  readGallerySession,
  type GallerySession,
} from "./auth";
import { hashIp, verifyPin } from "./crypto";
import { asLang } from "../../i18n/lang";
import { isExpired } from "./time";

type GalleryEnv = Pick<Env, "DB" | "SESSION_SECRET"> &
  Partial<Pick<Env, "DRIVE_MODE">>;

export const VIEW_DEDUPE_MS = 30 * 60 * 1000;
const BOT_RE =
  /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget/i;

function shouldLogView(request: Request): boolean {
  if (request.method === "HEAD") return false;
  const h = request.headers;
  if (/prefetch/i.test(h.get("Purpose") ?? "")) return false;
  if (/prefetch/i.test(h.get("Sec-Purpose") ?? "")) return false;
  if (BOT_RE.test(h.get("User-Agent") ?? "")) return false;
  return true;
}

export type GalleryData =
  | { state: "unavailable" }
  | { state: "locked"; title: string }
  | { state: "open"; gallery: OpenGallery; photos: GalleryPhoto[] };

export type LoadResult = {
  status: 200 | 404;
  data: GalleryData;
  /** Set-Cookie value to send (session `viewed` flag), if any. */
  setCookie?: string;
};

const unavailable = (): LoadResult => ({
  status: 404,
  data: { state: "unavailable" },
});

export const isSecure = (request: Request) =>
  new URL(request.url).protocol === "https:";

export async function findGallery(env: GalleryEnv, slug: string) {
  const [g] = await getDb(env as Env)
    .select()
    .from(schema.galleries)
    .where(sql`${schema.galleries.slug} = ${slug} COLLATE NOCASE`);
  return g;
}

/** Draft, archived, expired and unknown all look the same. */
export function isAvailable(
  g: typeof schema.galleries.$inferSelect | undefined,
) {
  return !!g && g.status === "published" && !isExpired(g.expiresAt);
}

export async function loadGallery(
  request: Request,
  slug: string,
  env: GalleryEnv,
): Promise<LoadResult> {
  const g = await findGallery(env, slug);
  if (!g || !isAvailable(g)) return unavailable();

  const session = await readGallerySession(
    request,
    { id: g.id, pinHash: g.pinHash },
    env,
  );
  if (g.pinHash && !session?.unlocked) {
    return { status: 200, data: { state: "locked", title: g.title } };
  }

  const db = getDb(env as Env);
  const rows = await db
    .select({
      id: schema.photos.id,
      width: schema.photos.width,
      height: schema.photos.height,
      set: schema.photos.setName,
    })
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );

  const sets: { name: string; count: number }[] = [];
  for (const p of rows) {
    const last = sets[sets.length - 1];
    if (last?.name === p.set) last.count++;
    else sets.push({ name: p.set, count: 1 });
  }
  const cover =
    g.coverPhotoId && rows.some((p) => p.id === g.coverPhotoId)
      ? g.coverPhotoId
      : (rows[0]?.id ?? null);

  let setCookie: string | undefined;
  if (!session?.viewed) {
    try {
      if (shouldLogView(request)) {
        const country = (request as { cf?: { country?: string } }).cf?.country;
        const ipHash = await hashIp(
          request.headers.get("CF-Connecting-IP") ?? "unknown",
          env.SESSION_SECRET,
        );
        const cutoff = nowIso(new Date(Date.now() - VIEW_DEDUPE_MS));
        if (session?.visitorId) {
          await db.insert(schema.galleryViews).values({
            galleryId: g.id,
            visitorId: session.visitorId,
            country: country ?? null,
            ipHash,
          });
        } else {
          // Cookieless: one row per (gallery, ip) per 30 minutes.
          await env.DB.prepare(
            `INSERT INTO gallery_views (gallery_id, visitor_id, country, ip_hash, created_at)
             SELECT ?1, NULL, ?2, ?3, ?4
             WHERE NOT EXISTS (SELECT 1 FROM gallery_views
               WHERE gallery_id = ?1 AND ip_hash = ?3 AND created_at > ?5)`,
          )
            .bind(g.id, country ?? null, ipHash, nowIso(), cutoff)
            .run();
        }
      }
      const next: GallerySession = {
        galleryId: g.id,
        unlocked: session?.unlocked ?? true,
        pf: session?.pf ?? (await pinFingerprint(g.pinHash, env)),
        ...(session?.visitorId ? { visitorId: session.visitorId } : {}),
        viewed: true,
      };
      setCookie = await gallerySessionCookie(next, env, {
        secure: isSecure(request),
      });
    } catch (err) {
      console.error("gallery view logging failed", err);
    }
  }

  return {
    status: 200,
    data: {
      state: "open",
      gallery: {
        slug: g.slug,
        requireEmail: g.requireEmail,
        title: g.title,
        eventDate: g.eventDate,
        clientName: g.clientName,
        coverPhotoId: cover,
        allowBulk: g.allowBulk,
        sets,
      },
      photos: rows,
    },
    ...(setCookie ? { setCookie } : {}),
  };
}

// ---------------------------------------------------------------- PIN unlock

const UNKNOWN_GALLERY = "unknown";
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_WINDOW_MS = 10 * 60 * 1000;

// Valid-format hash of nothing: unknown slugs still pay for one PBKDF2 run.
const DUMMY_HASH = `pbkdf2$100000$${"A".repeat(22)}$${"A".repeat(43)}`;

export type UnlockResult =
  | { status: 303; location: string; setCookie: string }
  | { status: 303; location: string; setCookie?: undefined }
  | { status: 400 | 403 | 404 | 429 };

export function crossSite(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Counts this attempt atomically; returns the count in the current window. */
async function countAttempt(
  env: GalleryEnv,
  ipHash: string,
  galleryId: string,
): Promise<number> {
  const now = nowIso();
  const cutoff = nowIso(new Date(Date.now() - PIN_WINDOW_MS));
  const row = await env.DB.prepare(
    `INSERT INTO pin_attempts (ip_hash, gallery_id, count, window_start)
     VALUES (?1, ?2, 1, ?3)
     ON CONFLICT (ip_hash, gallery_id) DO UPDATE SET
       count = CASE WHEN window_start <= ?4 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?4 THEN ?3 ELSE window_start END
     RETURNING count`,
  )
    .bind(ipHash, galleryId, now, cutoff)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

export async function unlockGallery(
  request: Request,
  slug: string,
  env: GalleryEnv,
): Promise<UnlockResult> {
  if (crossSite(request)) return { status: 403 };

  let pin = "";
  try {
    const v = (await request.formData()).get("pin");
    if (typeof v === "string") pin = v.slice(0, 256);
  } catch {
    /* treated as empty */
  }

  const g = await findGallery(env, slug);
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    (env.DRIVE_MODE === "mock" ? "local" : null);
  const ipHash = ip ? await hashIp(ip, env.SESSION_SECRET) : null;
  if (!g || !isAvailable(g)) {
    if (!ipHash) return { status: 429 };
    if ((await countAttempt(env, ipHash, UNKNOWN_GALLERY)) > PIN_MAX_ATTEMPTS) {
      return { status: 429 };
    }
    await verifyPin(pin, DUMMY_HASH);
    return { status: 404 };
  }
  const lang = asLang(new URL(request.url).searchParams.get("lang"));
  const location =
    "/" + encodeURIComponent(g.slug) + (lang ? `?lang=${lang}` : "");
  if (!g.pinHash) return { status: 303, location };

  if (!ipHash) return { status: 429 };
  if ((await countAttempt(env, ipHash, g.id)) > PIN_MAX_ATTEMPTS) {
    return { status: 429 };
  }
  const ok = await verifyPin(pin, g.pinHash);
  if (!ok || !pin) return { status: 400 };

  await getDb(env as Env)
    .delete(schema.pinAttempts)
    .where(
      and(
        eq(schema.pinAttempts.ipHash, ipHash),
        eq(schema.pinAttempts.galleryId, g.id),
      ),
    );
  const setCookie = await gallerySessionCookie(
    {
      galleryId: g.id,
      unlocked: true,
      pf: await pinFingerprint(g.pinHash, env),
    },
    env,
    { secure: isSecure(request) },
  );
  return { status: 303, location, setCookie };
}
