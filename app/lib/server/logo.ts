import { inArray } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { deleteSetting, putSetting, SETTINGS_KEYS } from "./settings";
import { NO_STORE, NOSNIFF } from "./http";
import {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  LOGO_VARIANTS,
  isLogoVariant,
} from "./logo-types";
import type { LogoCheck, LogoType, LogoVariant } from "./logo-types";
import { validateLogo } from "./logo-validate";

// Public facade: byte validation lives in logo-validate/logo-svg, shared types
// in logo-types; this module stores and serves the logos.
export {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  LOGO_VARIANTS,
  isLogoVariant,
} from "./logo-types";
export type { LogoCheck, LogoError, LogoType, LogoVariant } from "./logo-types";
export { validateLogo } from "./logo-validate";

/** Multipart framing and the other form fields on top of the file itself. */
const FORM_OVERHEAD_BYTES = 16 * 1024;
export const SETUP_BODY_MAX_BYTES = LOGO_MAX_BYTES + FORM_OVERHEAD_BYTES;

/**
 * Fixed R2 key prefixes and settings rows per variant. The object key is
 * `<prefix>-<v>` where `v` is the server-computed content hash: nothing in a
 * key comes from user input.
 */
const SLOTS: Record<LogoVariant, { r2Prefix: string; setting: string }> = {
  "on-light": {
    r2Prefix: "brand/logo-on-light",
    setting: SETTINGS_KEYS.logoOnLight,
  },
  "on-dark": {
    r2Prefix: "brand/logo-on-dark",
    setting: SETTINGS_KEYS.logoOnDark,
  },
};
const r2KeyOf = (variant: LogoVariant, v: string) =>
  `${SLOTS[variant].r2Prefix}-${v}`;

/**
 * Reads a request body but gives up (null) as soon as it exceeds `max`:
 * Content-Length is checked first, then the stream is counted chunk by chunk.
 */
export async function readBodyLimited(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > max) {
    await request.body?.cancel().catch(() => {});
    return null;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// ---- storage (R2 object `<prefix>-<v>` + settings row `{t: type, v: version}`) ----

interface LogoMeta {
  t: LogoType;
  v: string;
}
const VERSION_RE = /^[0-9a-f]{16}$/;

function parseMeta(raw: string | undefined): LogoMeta | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<LogoMeta> | null;
    if (
      m &&
      typeof m.t === "string" &&
      (LOGO_TYPES as readonly string[]).includes(m.t) &&
      typeof m.v === "string" &&
      VERSION_RE.test(m.v)
    )
      return { t: m.t as LogoType, v: m.v };
  } catch {
    /* corrupt row: treated as "no custom logo" */
  }
  return null;
}

async function readMetas(
  env: Pick<Env, "DB">,
): Promise<Record<LogoVariant, LogoMeta | null>> {
  const out: Record<LogoVariant, LogoMeta | null> = {
    "on-light": null,
    "on-dark": null,
  };
  try {
    const rows = await getDb(env as Env)
      .select()
      .from(schema.settings)
      .where(
        inArray(
          schema.settings.key,
          LOGO_VARIANTS.map((v) => SLOTS[v].setting),
        ),
      );
    for (const v of LOGO_VARIANTS)
      out[v] = parseMeta(rows.find((r) => r.key === SLOTS[v].setting)?.value);
  } catch {
    /* DB trouble: fall back to the bundled logo */
  }
  return out;
}

/** Public, non-secret cache-busting versions (null = the bundled logo). */
export async function getLogoVersions(
  env: Pick<Env, "DB">,
): Promise<{ onLight: string | null; onDark: string | null }> {
  const m = await readMetas(env);
  return { onLight: m["on-light"]?.v ?? null, onDark: m["on-dark"]?.v ?? null };
}

async function versionOf(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  return [...d.slice(0, 8)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validates, then stores. Objects are versioned (`<prefix>-<v>`), so a new
 * upload never overwrites the one the pointer names: put the object, write the
 * pointer (the commit point), then drop the old object best-effort.
 */
export async function saveLogo(
  env: Pick<Env, "DB" | "CACHE">,
  variant: LogoVariant,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<LogoCheck> {
  const check = validateLogo(bytes);
  if (!check.ok) return check;
  const v = await versionOf(bytes);
  const key = r2KeyOf(variant, v);
  await env.CACHE.put(key, bytes, {
    httpMetadata: { contentType: check.type },
    customMetadata: { v },
  });
  const previous = (await readMetas(env))[variant];
  try {
    await putSetting(
      env,
      SLOTS[variant].setting,
      JSON.stringify({ t: check.type, v }),
    );
  } catch (err) {
    // Not committed: the old pointer and its object are untouched.
    if (previous?.v !== v) await env.CACHE.delete(key).catch(() => {});
    throw err;
  }
  if (previous && previous.v !== v)
    await env.CACHE.delete(r2KeyOf(variant, previous.v)).catch(() => {});
  return check;
}

/** Back to the bundled logos: clears the pointers first, then the objects. */
export async function resetLogos(
  env: Pick<Env, "DB" | "CACHE">,
): Promise<void> {
  const metas = await readMetas(env);
  for (const variant of LOGO_VARIANTS)
    await deleteSetting(env, SLOTS[variant].setting);
  for (const variant of LOGO_VARIANTS) {
    const m = metas[variant];
    if (m) await env.CACHE.delete(r2KeyOf(variant, m.v)).catch(() => {});
  }
}

/** Public resource: GET /brand/logo/:variant?v=<version>. */
export async function serveLogo(
  request: Request,
  variant: string | undefined,
  env: Pick<Env, "DB" | "CACHE">,
): Promise<Response> {
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": NO_STORE, ...NOSNIFF },
    });
  if (!isLogoVariant(variant)) return notFound();
  const meta = (await readMetas(env))[variant];
  if (!meta) return notFound();
  const obj = await env.CACHE.get(r2KeyOf(variant, meta.v));
  if (!obj || obj.customMetadata?.v !== meta.v) return notFound();
  const asked = new URL(request.url).searchParams.get("v");
  return new Response(obj.body, {
    headers: {
      "Content-Type": meta.t,
      "Content-Length": String(obj.size),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Even opened directly, an SVG here can not run script or load anything.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control":
        asked === meta.v
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
    },
  });
}
