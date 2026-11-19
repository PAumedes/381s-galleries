import type { loadGalleryEdit } from "../../../lib/server/admin-galleries";

export type GalleryEditData = NonNullable<
  Awaited<ReturnType<typeof loadGalleryEdit>>
>;

/** The gallery as the editor shows it (optimistic cover applied). */
export type EditGallery = GalleryEditData["gallery"];

/** Field errors of one action intent, keyed by field name. */
export type FieldErrors = Record<string, string | undefined>;
