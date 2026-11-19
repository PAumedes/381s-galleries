import { crossSite } from "./access";
import { requireAdmin } from "./auth";
import { getSetting, SETTINGS_KEYS } from "./settings";
import { DEFAULT_STUDIO_NAME } from "../default-studio-name";

/** Response headers every admin page and action must carry. */
export function adminHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * Guard for every admin mutation (React Router action): admin first (401),
 * then cross-site refusal (403). Returns the admin email (lowercased).
 */
export async function adminAction(
  request: Request,
  env: Parameters<typeof requireAdmin>[1],
): Promise<string> {
  await requireAdmin(request, env);
  if (crossSite(request)) throw new Response("Forbidden", { status: 403 });
  return (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Drive folder id from a pasted folder URL (scheme optional; /drive/folders/<id>,
 * /drive/u/N/folders/<id>, /drive/mobile/folders/<id>, open?id=<id>; extra
 * path segments, query and fragment ignored) or a bare id. Null otherwise.
 */
export function parseDriveFolderId(input: string): string | null {
  const v = input.trim();
  if (ID_RE.test(v)) return v;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "drive.google.com") return null;
  const m = /^\/drive\/(?:u\/\d+\/|mobile\/)?folders\/([^/]+)(?:\/.*)?$/.exec(
    u.pathname,
  );
  const id = m
    ? m[1]
    : u.pathname === "/open"
      ? u.searchParams.get("id")
      : null;
  return id && ID_RE.test(id) ? id : null;
}

export const STUDIO_NAME_MAX = 60;

/** Trimmed studio name if valid (1-60 chars, no control characters), else null. */
export function validStudioName(input: string): string | null {
  const v = input.trim();
  if (v.length < 1 || v.length > STUDIO_NAME_MAX) return null;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v)) return null;
  // Needs at least one visible character (letters, marks, numbers, punctuation, symbols).
  if (
    !/[\p{L}\p{N}\p{P}\p{S}]/u.test(
      v.replace(/[\u3164\uFFA0\u115F\u1160]/gu, ""),
    )
  )
    return null;
  return v;
}

/** env STUDIO_NAME if valid, else the neutral default (never raw env text). */
function envStudioName(env: { STUDIO_NAME?: string }): string {
  return validStudioName(env.STUDIO_NAME ?? "") ?? DEFAULT_STUDIO_NAME;
}

const nameCache = new WeakMap<Request, Promise<string>>();

/** Studio name: settings first, env STUDIO_NAME fallback; cached per request. */
export function getStudioName(
  env: Pick<Env, "DB" | "STUDIO_NAME">,
  request?: Request,
): Promise<string> {
  const hit = request && nameCache.get(request);
  if (hit) return hit;
  const p = (async () => {
    try {
      const v = await getSetting(env, SETTINGS_KEYS.studioName);
      return (v && validStudioName(v)) || envStudioName(env);
    } catch {
      return envStudioName(env);
    }
  })();
  if (request) nameCache.set(request, p);
  return p;
}
