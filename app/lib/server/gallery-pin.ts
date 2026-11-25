/** PIN unlock of a locked gallery (POST), with its two rate limits. */
import { asLang } from "../../i18n/lang";
import { galleryPath } from "../gallery-path";
import {
  clientGateClosed,
  clientIpHash,
  crossSite,
  isAvailable,
  isPinned,
  isSecure,
  openGallery,
} from "./access";
import type { AccessEnv } from "./access";
import { updateSession } from "./auth";
import { clientUnlockCookie } from "./client-unlock";
import { verifyPin } from "./crypto";
import { findGalleryWithClient, sameClient } from "./gallery-resolve";
import {
  hit,
  refundRateLimit,
  resetRateLimit,
  type RateRule,
} from "./rate-limit";

type GalleryEnv = AccessEnv;

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
  /** `/:client/:album` POST: the client segment must be the album's client. */
  client?: string,
): Promise<UnlockResult> {
  if (crossSite(request)) return { status: 403 };

  let pin = "";
  try {
    const v = (await request.formData()).get("pin");
    if (typeof v === "string") pin = v.slice(0, 256);
  } catch {
    /* treated as empty */
  }

  const found = await findGalleryWithClient(env, slug);
  const g = found?.gallery;
  const ipHash = await clientIpHash(request, env, { prefix64: true });
  const pinLimit = (galleryId: string, ip: string) =>
    hit(env, PIN_RATE, `${ip}:${galleryId}`);
  // A wrong client segment is as unavailable as an unknown album (no redirect).
  if (
    !isAvailable(g) ||
    !(client === undefined || sameClient(client, found!.clientSlug))
  ) {
    if (!ipHash) return { status: 429 };
    if (!(await pinLimit(UNKNOWN_GALLERY, ipHash))) return { status: 429 };
    await verifyPin(pin, DUMMY_HASH);
    return { status: 404 };
  }
  const lang = asLang(new URL(request.url).searchParams.get("lang"));
  const location =
    galleryPath(g.slug, found!.clientSlug) + (lang ? `?lang=${lang}` : "");
  if (!isPinned(g)) return { status: 303, location };

  // Already unlocked: nothing to verify and never throttled.
  if ((await openGallery(request, g, env)) !== null)
    return { status: 303, location };

  if (!ipHash) return { status: 429 };
  // Client PIN first (T6.52), then the album's own. Its guesses are budgeted
  // per CLIENT, so rotating across the client's albums multiplies nothing.
  const forClient = await clientGateClosed(request, g, env);
  const scopeId = forClient ? g.clientId! : g.id;
  const stored = forClient ? g.clientPinHash! : g.pinHash!;
  if (!(await pinLimit(scopeId, ipHash))) return { status: 429 };
  if (!(await hit(env, PIN_GALLERY_RATE, scopeId))) return { status: 429 };
  const ok = await verifyPin(pin, stored);
  if (!ok || !pin) return { status: 400 };

  await resetRateLimit(env, PIN_RATE.scope, `${ipHash}:${scopeId}`);
  // Only wrong guesses consume the gallery-wide budget: refund just this
  // attempt's hit. Never reset the counter, or a correct PIN would hand
  // guessers a fresh budget (PLAN §6: 100 wrong guesses / 10 min / gallery).
  await refundRateLimit(env, PIN_GALLERY_RATE.scope, scopeId);
  const setCookie = forClient
    ? await clientUnlockCookie({ id: g.clientId!, pinHash: stored }, env, {
        secure: isSecure(request),
      })
    : await updateSession(request, g, { unlocked: true }, env);
  return { status: 303, location, setCookie };
}
