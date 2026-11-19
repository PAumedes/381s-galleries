import type { Design } from "../../../lib/design";
import type { loadGalleryEdit } from "../../../lib/server/admin-galleries";
import type { versionsOf } from "../../img-url";
import type { PreviewDevice } from "../LivePreview";

export type GalleryEditData = NonNullable<
  Awaited<ReturnType<typeof loadGalleryEdit>>
>;

/** The gallery as the editor shows it (optimistic cover applied). */
export type EditGallery = GalleryEditData["gallery"];

/** Field errors of one action intent, keyed by field name. */
export type FieldErrors = Record<string, string>;

/** What every live preview of the editor shows (the unsaved local state). */
export type PreviewState = {
  title: string;
  eventDate: string;
  design: Design;
  proofing: boolean;
  versions: ReturnType<typeof versionsOf>;
  device: PreviewDevice;
  onDevice: (d: PreviewDevice) => void;
};

/** Cover photos of the gallery as the editor resolves them. */
export type EditorCover = {
  coverId: string | null;
  coverPhoto: GalleryEditData["photos"][number] | undefined;
  mobilePhoto: GalleryEditData["photos"][number] | undefined;
};
