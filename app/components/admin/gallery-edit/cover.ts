import type { EditGallery, EditorCover, GalleryEditData } from "./types";

/** Cover and mobile-cover photos: the chosen one, else the first photo. */
export function resolveEditorCover(
  g: EditGallery,
  photos: GalleryEditData["photos"],
): EditorCover {
  const coverId = g.coverPhotoId ?? photos[0]?.id ?? null;
  return {
    coverId,
    coverPhoto: photos.find((p) => p.id === coverId),
    mobilePhoto: g.coverPhotoIdMobile
      ? photos.find((p) => p.id === g.coverPhotoIdMobile)
      : undefined,
  };
}

export { aspectOf } from "../../cover-files";
