/** PIN unlock of a locked gallery (POST), with its two rate limits. */
import { asLang } from "../../i18n/lang";
import { galleryPath } from "../gallery-path";
import { PIN_MAX_ATTEMPTS } from "../pin-rules";
import {
  clientGateClosed,
  clientIpHash,
  crossSite,
  isAvailable,
  isPinned,
  isSecure,
  openGallery,
} from "./access";
import type { AccessEnv, PinStep } from "./access";
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
export { PIN_MAX_ATTEMPTS };
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
  | { status: 400; step: PinStep; attempt: number }
  | { status: 403; attempt: number }
  | { status: 404 | 429; attempt: number };

/**
 * What the gate form posted: the PIN and the cosmetic attempt counter (a plain
 * count of at most 4 digits, else 0; the rate limit, not this, stops guessing).
 */
async function readGateForm(
  request: Request,
): Promise<{ pin: string; attempt: number }> {
  let pin = "";
  let attempt = 0;
  try {
    const form = await request.formData();
    const v = form.get("pin");
    if (typeof v === "string") pin = v.slice(0, 256);
    const a = form.get("attempt");
    if (typeof a === "string" && /^\d{1,4}$/.test(a)) attempt = Number(a);
  } catch {
    /* treated as empty */
  }
  return { pin, attempt };
}

export async function unlockGallery(
  request: Request,
  slug: string,
  env: GalleryEnv,
  /** `/:client/:album` POST: the client segment must be the album's client. */
  client?: string,
): Promise<UnlockResult> {
  if (crossSite(request)) return { status: 403, attempt: 0 };

  // The one parse of the body: the PIN and the cosmetic attempt counter.
  const { pin, attempt } = await readGateForm(request);

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
    if (!ipHash) return { status: 429, attempt };
    if (!(await pinLimit(UNKNOWN_GALLERY, ipHash)))
      return { status: 429, attempt };
    await verifyPin(pin, DUMMY_HASH);
    return { status: 404, attempt };
  }
  const lang = asLang(new URL(request.url).searchParams.get("lang"));
  const location =
    galleryPath(g.slug, found!.clientSlug) + (lang ? `?lang=${lang}` : "");
  if (!isPinned(g)) return { status: 303, location };

  // Already unlocked: nothing to verify and never throttled.
  if ((await openGallery(request, g, env)) !== null)
    return { status: 303, location };

  if (!ipHash) return { status: 429, attempt };
  // Client PIN first (T6.52), then the album's own. Its guesses are budgeted
  // per CLIENT, so rotating across the client's albums multiplies nothing.
  const forClient = await clientGateClosed(request, g, env);
  const scopeId = forClient ? g.clientId! : g.id;
  const stored = forClient ? g.clientPinHash! : g.pinHash!;
  if (!(await pinLimit(scopeId, ipHash))) return { status: 429, attempt };
  if (!(await hit(env, PIN_GALLERY_RATE, scopeId)))
    return { status: 429, attempt };
  const ok = await verifyPin(pin, stored);
  if (!ok || !pin)
    return { status: 400, step: forClient ? "client" : "album", attempt };

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
