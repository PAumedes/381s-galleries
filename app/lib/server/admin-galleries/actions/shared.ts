import type { schema } from "../../../../db";
import type { DriveClient } from "../../drive-types";
import type { Device } from "../../cover";

// Shared by every gallery action intent.

export interface GalleryActionResult {
  intent: string;
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Reorder only: the photo set changed since the page was loaded. */
  stale?: boolean;
  /** Delete only: the deletion is not finished yet; submit again. */
  continuing?: boolean;
}

export const fail = (
  intent: string,
  error: string,
  fieldErrors?: Record<string, string>,
  extra: Partial<GalleryActionResult> = {},
): GalleryActionResult => ({
  intent,
  ok: false,
  error,
  ...(fieldErrors ? { fieldErrors } : {}),
  ...extra,
});
export const done = (intent: string, message: string): GalleryActionResult => ({
  intent,
  ok: true,
  message,
});
export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

/** Optional extras of a gallery action (the route injects them). */
export interface GalleryActionDeps {
  ctx?: Pick<ExecutionContext, "waitUntil">;
  /** Present = warm R2 after a cover save; the route passes none in mock mode. */
  drive?: DriveClient;
}

export type GalleryRow = typeof schema.galleries.$inferSelect;

// Control chars and bidi overrides/isolates only (ZWJ/ZWNJ are legitimate).
export const CONTROL_RE = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/**
 * Which cover a cover/focus form targets: absent or "desktop" = the desktop
 * cover, "mobile" = the optional mobile cover. Anything else (other strings,
 * files) is refused.
 */
export function deviceOf(f: FormData): Device | null {
  const v = f.get("device");
  if (v === null || v === "desktop") return "desktop";
  return v === "mobile" ? "mobile" : null;
}
