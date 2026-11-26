/** Byte sizes for the visitor, language-neutral ("312 MB", "1.4 GB"). */
export const MB = 1024 * 1024;

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / MB))} MB`;
}
