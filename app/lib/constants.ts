/**
 * Literal lists shared by the client, the server and the schema. One
 * definition each; no server-only imports (this file ships to the browser).
 */

/** Sizes served at `/img/:photoId/:variant` (and cached in R2 under `<id>/<variant>`). */
export const IMAGE_VARIANTS = ["thumb", "view-sm", "view-lg"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

/** Sizes a client can download (the Capture One recipes: high-res, web, Instagram). */
export const DOWNLOAD_SIZES = ["highres", "web", "ig"] as const;
export type DownloadSize = (typeof DOWNLOAD_SIZES)[number];

/** Proofing (Prueba): watermarked, no downloads. Delivery (Entrega): clean, downloads per flags. */
export const GALLERY_MODES = ["proofing", "delivery"] as const;
export type GalleryMode = (typeof GALLERY_MODES)[number];

export const GALLERY_STATUSES = ["draft", "published", "archived"] as const;
export type GalleryStatus = (typeof GALLERY_STATUSES)[number];
