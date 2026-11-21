export const LOGO_MAX_BYTES = 512 * 1024;
/** Multipart framing and the other form fields on top of the file itself. */
const FORM_OVERHEAD_BYTES = 16 * 1024;
export const SETUP_BODY_MAX_BYTES = LOGO_MAX_BYTES + FORM_OVERHEAD_BYTES;

export const LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const LOGO_VARIANTS = ["on-light", "on-dark"] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

/** Largest accepted raster side, in pixels (decode-bomb guard). */
export const MAX_SIDE = 4096;
export const sideOk = (w: number, h: number) =>
  w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE;

export const isLogoVariant = (v: unknown): v is LogoVariant =>
  typeof v === "string" && (LOGO_VARIANTS as readonly string[]).includes(v);

export type LogoError =
  "empty" | "too_large" | "unsupported" | "corrupt" | "svg_unsafe";
export type LogoCheck =
  { ok: true; type: LogoType } | { ok: false; error: LogoError };

export const bad = (error: LogoError): LogoCheck => ({ ok: false, error });
export const ascii = (b: Uint8Array, at: number, s: string) =>
  b.length >= at + s.length &&
  [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
