import { clickAnchor, DownloadError, requestTokens } from "./download-net";
import type { DlVariant, DownloadDeps } from "./download-net";
import { estimateBytes, LARGE_BYTES } from "./download-bulk";
import { formatBytes } from "./format-bytes";

/** Public surface of the download code; the parts live in download-net, download-bulk and zip-names. */
export * from "./download-net";
export { downloadBulk, estimateBytes } from "./download-bulk";
export type { BulkOptions, BulkProgress, BulkResult } from "./download-bulk";
export { bulkZipName, safeZipName } from "./zip-names";

export async function downloadSingle(
  slug: string,
  photoId: string,
  variant: DlVariant,
  deps?: DownloadDeps,
): Promise<void> {
  const { tokens } = await requestTokens(
    slug,
    [photoId],
    variant,
    undefined,
    deps,
  );
  const token = tokens[0];
  if (!token) throw new DownloadError("unavailable");
  // /dl answers with an attachment (mock mode: a 302 to the image, which just navigates).
  clickAnchor(token.url, token.filename);
}

const isIos = (ua: string) => /iPhone|iPad/.test(ua);

/** Warn BEFORE a download that would be held in memory (no file picker). */
export function bulkWarning(o: {
  count: number;
  variant: DlVariant;
  totalBytes?: number;
  picker: boolean;
  userAgent?: string;
}): "ios" | "large" | null {
  if (o.picker) return null;
  const ua =
    o.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (isIos(ua)) return "ios";
  return estimateBytes(o.count, o.variant, o.totalBytes) > LARGE_BYTES
    ? "large"
    : null;
}

export { formatBytes };
