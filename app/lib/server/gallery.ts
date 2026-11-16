import { and, asc, eq } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../../db";
import type { OpenGallery } from "../../components/types";
import type { GalleryPhoto } from "../../components/types";
import { updateSession } from "./auth";
import {
  clientIpHash,
  crossSite,
  findGallery,
  isAvailable,
  isSecure,
  openGallery,
  type AccessEnv,
} from "./access";
import { verifyPin } from "./crypto";
import { asLang } from "../../i18n/lang";
import { rateLimit, resetRateLimit } from "./rate-limit";

type GalleryEnv = AccessEnv;

// Re-exported for existing importers.
export { crossSite, findGallery, isAvailable, isSecure };

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

export async function loadGallery(
  request: Request,
  slug: string,
  env: GalleryEnv,
): Promise<LoadResult> {
  // Slugs with a dot are files (favicon.ico, robots.txt, ...), never galleries.
  if (slug.includes(".")) return unavailable();
  const g = await findGallery(env, slug);
  if (!isAvailable(g)) return unavailable();

  const open = await openGallery(request, g, env);
  if (!open) {
    return { status: 200, data: { state: "locked", title: g.title } };
  }
  const { session } = open;

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
        const ipHash = await clientIpHash(request, env);
        if (!session?.visitorId && !ipHash) {
          // Cookieless request with no client IP (never happens behind
          // Cloudflare): skip logging rather than allow unbounded inflation.
        } else if (session?.visitorId) {
          await db.insert(schema.galleryViews).values({
            galleryId: g.id,
            visitorId: session?.visitorId ?? null,
            country: country ?? null,
            ipHash,
          });
        } else {
          // Cookieless: one row per (gallery, ip) per 30 minutes.
          const cutoff = nowIso(new Date(Date.now() - VIEW_DEDUPE_MS));
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
      setCookie = await updateSession(request, g, { viewed: true }, env);
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
        allowHighres: g.allowHighres,
        allowWeb: g.allowWeb,
        allowIg: g.allowIg,
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
  const ipHash = await clientIpHash(request, env);
  const pinLimit = (galleryId: string, ip: string) =>
    rateLimit(
      env,
      "pin",
      `${ip}:${galleryId}`,
      PIN_MAX_ATTEMPTS,
      PIN_WINDOW_MS,
    );
  if (!isAvailable(g)) {
    if (!ipHash) return { status: 429 };
    if (!(await pinLimit(UNKNOWN_GALLERY, ipHash))) return { status: 429 };
    await verifyPin(pin, DUMMY_HASH);
    return { status: 404 };
  }
  const lang = asLang(new URL(request.url).searchParams.get("lang"));
  const location =
    "/" + encodeURIComponent(g.slug) + (lang ? `?lang=${lang}` : "");
  if (!g.pinHash) return { status: 303, location };

  if (!ipHash) return { status: 429 };
  if (!(await pinLimit(g.id, ipHash))) return { status: 429 };
  const ok = await verifyPin(pin, g.pinHash);
  if (!ok || !pin) return { status: 400 };

  await resetRateLimit(env, "pin", `${ipHash}:${g.id}`);
  const setCookie = await updateSession(request, g, { unlocked: true }, env);
  return { status: 303, location, setCookie };
}
