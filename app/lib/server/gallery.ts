import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../../db";
import type { OpenGallery } from "../../components/types";
import type { GalleryPhoto } from "../../components/types";
import type { Palette } from "../design";
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
import { focusOf, resolveCover } from "./cover";
import { imageVersionToken } from "./images";
import { asLang } from "../../i18n/lang";
import {
  hit,
  refundRateLimit,
  resetRateLimit,
  type RateRule,
} from "./rate-limit";
import { visitorInfo, type VisitorInfo } from "./visitor-info";

type GalleryEnv = AccessEnv;

// Re-exported for existing importers.
export { crossSite, findGallery, isAvailable, isSecure };

export const VIEW_DEDUPE_MS = 30 * 60 * 1000;

type ViewRow = VisitorInfo & { galleryId: string; visitorId: string | null };

/**
 * Cookieless views: one row per (gallery, ip_hash) per `VIEW_DEDUPE_MS`, decided
 * atomically in one statement. Only while the gallery exists, so a request
 * racing a gallery deletion cannot leave an orphan row.
 */
export async function insertViewOnce(
  env: GalleryEnv,
  row: ViewRow,
): Promise<void> {
  const columns = getTableColumns(schema.galleryViews);
  const values: Record<string, unknown> = { ...row, createdAt: nowIso() };
  const keys = Object.keys(values) as (keyof typeof columns)[];
  const param = (k: string) => `?${keys.indexOf(k as never) + 1}`;
  const cutoff = `?${keys.length + 1}`;
  await env.DB.prepare(
    `INSERT INTO gallery_views (${keys.map((k) => columns[k].name).join(", ")})
     SELECT ${keys.map((_, i) => `?${i + 1}`).join(", ")}
     WHERE EXISTS (SELECT 1 FROM galleries WHERE id = ${param("galleryId")})
       AND NOT EXISTS (SELECT 1 FROM gallery_views
       WHERE gallery_id = ${param("galleryId")} AND ip_hash = ${param("ipHash")} AND created_at > ${cutoff})`,
  )
    .bind(
      ...keys.map((k) => values[k] ?? null),
      nowIso(new Date(Date.now() - VIEW_DEDUPE_MS)),
    )
    .run();
}
const BOT_RE =
  /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|mastodon|embedly|iframely|http\.rb|signal|viber|line-poker|pinterest|skype/i;

function shouldLogView(request: Request): boolean {
  if (request.method === "HEAD") return false;
  const h = request.headers;
  if (/prefetch/i.test(h.get("Purpose") ?? "")) return false;
  if (/prefetch/i.test(h.get("Sec-Purpose") ?? "")) return false;
  if (BOT_RE.test(h.get("User-Agent") ?? "")) return false;
  // Real browsers send Sec-Fetch-*; a cookieless request without it is a bot.
  if (!h.get("Sec-Fetch-Mode") && !h.get("Cookie")) return false;
  return true;
}

export type GalleryData =
  | { state: "unavailable" }
  | { state: "locked"; slug: string; title: string; palette: Palette }
  | {
      state: "open";
      gallery: OpenGallery;
      photos: GalleryPhoto[];
      /**
       * Link-preview data (Open Graph). null for PIN galleries: crawlers get
       * generic meta only. For public ones, `coverId` is the visible cover
       * (null when there are no photos); width/height = its aspect at a
       * 1200px long edge (null when unknown).
       */
      og: {
        coverId: string | null;
        width: number | null;
        height: number | null;
      } | null;
    };

export const OG_LONG_EDGE = 1200;

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

async function versionField(
  env: Env,
  photo: typeof schema.photos.$inferSelect,
  wm: boolean,
): Promise<{ v?: string }> {
  const v = await imageVersionToken(env, photo, wm);
  return v ? { v } : {};
}

type GalleryRow = typeof schema.galleries.$inferSelect;

/**
 * The client payload of an open gallery (cover, design, sets, photos with
 * their `?v=` tokens, link-preview data). No access checks and no side
 * effects: callers decide who may see it (`loadGallery` for visitors, the
 * admin preview for the owner). Never carries Drive ids, the client name or
 * PIN data.
 */
export async function buildOpenData(
  env: Env,
  g: GalleryRow,
): Promise<{
  gallery: OpenGallery;
  photos: GalleryPhoto[];
  og: {
    coverId: string | null;
    width: number | null;
    height: number | null;
  } | null;
}> {
  const db = getDb(env);
  const full = await db
    .select()
    .from(schema.photos)
    .where(and(eq(schema.photos.galleryId, g.id), photoVisible))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
  const rows = full.map((p) => ({
    id: p.id,
    width: p.width,
    height: p.height,
    set: p.setName,
    driveWebId: p.driveWebId,
    driveIgId: p.driveIgId,
    driveWmId: p.driveWmId,
  }));

  const sets: { name: string; count: number }[] = [];
  for (const p of rows) {
    const last = sets[sets.length - 1];
    if (last?.name === p.set) last.count++;
    else sets.push({ name: p.set, count: 1 });
  }
  // In proofing, crawlers only get /view-sm of a photo that has a
  // preview-wm; otherwise the og:image URL would 404.
  const proofing = g.mode === "proofing";
  const { cover, mobile } = resolveCover(
    rows.map((p) => ({ id: p.id, hasWm: !!p.driveWmId })),
    g,
  );
  const ogCover = proofing
    ? rows.find((p) => p.id === cover && p.driveWmId) ||
      rows.find((p) => p.driveWmId)
    : rows.find((p) => p.id === cover);
  const coverRow = ogCover;
  const long = Math.max(coverRow?.width ?? 0, coverRow?.height ?? 0);
  const scale = long > 0 ? OG_LONG_EDGE / long : 0;
  const og = g.pinHash
    ? null
    : {
        coverId: ogCover?.id ?? null,
        width:
          scale && coverRow?.width ? Math.round(coverRow.width * scale) : null,
        height:
          scale && coverRow?.height
            ? Math.round(coverRow.height * scale)
            : null,
      };

  return {
    gallery: {
      slug: g.slug,
      requireEmail: g.requireEmail,
      title: g.title,
      eventDate: g.eventDate,
      coverPhotoId: cover,
      coverFocus: focusOf(g.coverFocusX, g.coverFocusY),
      coverPhotoIdMobile: mobile,
      coverFocusMobile: mobile
        ? focusOf(g.coverFocusMobileX, g.coverFocusMobileY)
        : null,
      mode: g.mode,
      // Proofing: no downloads at all (the server refuses them too).
      allowBulk: !proofing && g.allowBulk,
      allowHighres: !proofing && g.allowHighres,
      allowWeb: !proofing && g.allowWeb,
      allowIg: !proofing && g.allowIg,
      palette: g.palette,
      coverLayout: g.coverLayout,
      gridStyle: g.gridStyle,
      gridGap: g.gridGap,
      sets,
    },
    photos: await Promise.all(
      rows.map(async ({ driveWebId, driveIgId, driveWmId: _wm, ...p }, i) => ({
        ...p,
        variants: { web: !!driveWebId, ig: !!driveIgId },
        // Opaque cache-busting token for the image URLs (never a Drive id).
        ...(await versionField(env, full[i], proofing)),
      })),
    ),
    og,
  };
}

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
    return {
      status: 200,
      data: {
        state: "locked",
        slug: g.slug,
        title: g.title,
        palette: g.palette,
      },
    };
  }
  const { session } = open;
  const db = getDb(env as Env);
  const built = await buildOpenData(env as Env, g);

  let setCookie: string | undefined;
  if (!session?.viewed) {
    try {
      if (shouldLogView(request)) {
        const info = await visitorInfo(request, env, g.id);
        if (!session?.visitorId && !info.ipHash) {
          // Cookieless request with no client IP (never happens behind
          // Cloudflare): skip logging rather than allow unbounded inflation.
        } else if (session?.visitorId) {
          await db
            .insert(schema.galleryViews)
            .values({ galleryId: g.id, visitorId: session.visitorId, ...info });
        } else {
          // Cookieless: one row per (gallery, ip) per 30 minutes.
          await insertViewOnce(env, {
            galleryId: g.id,
            visitorId: null,
            ...info,
          });
        }
      }
      setCookie = await updateSession(request, g, { viewed: true }, env);
    } catch (err) {
      console.error("gallery view logging failed", err);
    }
  }

  return {
    status: 200,
    data: { state: "open", ...built },
    ...(setCookie ? { setCookie } : {}),
  };
}

// ---------------------------------------------------------------- PIN unlock

const UNKNOWN_GALLERY = "unknown";
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_WINDOW_MS = 10 * 60 * 1000;
/** Per gallery, across all IPs (a 4-digit PIN is otherwise guessable by rotating IPs). */
export const PIN_GALLERY_MAX_ATTEMPTS = 100;
/** Wrong-PIN guesses per IP+gallery. */
const PIN_RATE: RateRule = {
  scope: "pin",
  max: PIN_MAX_ATTEMPTS,
  windowMs: PIN_WINDOW_MS,
};
/** Wrong-PIN guesses per gallery, all IPs. */
const PIN_GALLERY_RATE: RateRule = {
  scope: "pinG",
  max: PIN_GALLERY_MAX_ATTEMPTS,
  windowMs: PIN_WINDOW_MS,
};

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
  const ipHash = await clientIpHash(request, env, { prefix64: true });
  const pinLimit = (galleryId: string, ip: string) =>
    hit(env, PIN_RATE, `${ip}:${galleryId}`);
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

  // Already unlocked: nothing to verify and never throttled.
  if ((await openGallery(request, g, env)) !== null)
    return { status: 303, location };

  if (!ipHash) return { status: 429 };
  if (!(await pinLimit(g.id, ipHash))) return { status: 429 };
  if (!(await hit(env, PIN_GALLERY_RATE, g.id))) return { status: 429 };
  const ok = await verifyPin(pin, g.pinHash);
  if (!ok || !pin) return { status: 400 };

  await resetRateLimit(env, PIN_RATE.scope, `${ipHash}:${g.id}`);
  // Only wrong guesses consume the gallery-wide budget: refund just this
  // attempt's hit. Never reset the counter, or a correct PIN would hand
  // guessers a fresh budget (PLAN §6: 100 wrong guesses / 10 min / gallery).
  await refundRateLimit(env, PIN_GALLERY_RATE.scope, g.id);
  const setCookie = await updateSession(request, g, { unlocked: true }, env);
  return { status: 303, location, setCookie };
}
