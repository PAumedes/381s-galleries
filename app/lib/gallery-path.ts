/**
 * Public path of an album: `/<client>/<album>` when it belongs to a client
 * (T6.40), else `/<album>`. The one place that builds it (OG url, PWA scope,
 * share links, redirects).
 */
export function galleryPath(slug: string, clientSlug?: string | null): string {
  const album = encodeURIComponent(slug);
  return clientSlug
    ? `/${encodeURIComponent(clientSlug)}/${album}`
    : `/${album}`;
}
