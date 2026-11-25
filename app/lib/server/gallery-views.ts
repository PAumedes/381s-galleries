/** Gallery view logging: bot/prefetch filtering and the deduplicated `gallery_views` insert. */
import { getTableColumns } from "drizzle-orm";
import { getDb, nowIso, schema } from "../../db";
import type { AccessEnv } from "./access";
import { updateSession, type GallerySession } from "./auth";
import { visitorInfo, type VisitorInfo } from "./visitor-info";

type GalleryEnv = AccessEnv;
type GalleryRow = typeof schema.galleries.$inferSelect;

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

/**
 * Logs one gallery view (best-effort, never throws) and returns the
 * Set-Cookie value that marks the session as `viewed`. Only for requests
 * that carry no `viewed` flag yet.
 */
export async function recordView(
  request: Request,
  env: GalleryEnv,
  g: GalleryRow,
  session: GallerySession | null,
): Promise<string | undefined> {
  if (session?.viewed) return undefined;
  try {
    if (shouldLogView(request)) {
      const info = await visitorInfo(request, env, g.id);
      if (!session?.visitorId && !info.ipHash) {
        // Cookieless request with no client IP (never happens behind
        // Cloudflare): skip logging rather than allow unbounded inflation.
      } else if (session?.visitorId) {
        await getDb(env as Env)
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
    return await updateSession(request, g, { viewed: true }, env);
  } catch (err) {
    console.error("gallery view logging failed", err);
    return undefined;
  }
}
