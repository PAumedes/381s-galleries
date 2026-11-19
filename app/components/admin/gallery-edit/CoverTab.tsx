import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { CoverPreview } from "../CoverPreview";
import type {
  EditGallery,
  EditorCover,
  GalleryEditData,
  PreviewState,
} from "./types";

/** Portada tab: the focal-point editor over the cover preview. */
export function CoverTab({
  g,
  photos,
  cover: { coverId, coverPhoto, mobilePhoto },
  state: s,
  actionData,
}: {
  g: EditGallery;
  photos: GalleryEditData["photos"];
  cover: EditorCover;
  state: PreviewState;
  actionData: GalleryActionResult | undefined;
}) {
  return (
    <CoverPreview
      title={s.title}
      eventDate={s.eventDate || null}
      palette={s.design.palette}
      coverLayout={s.design.coverLayout}
      proofing={s.proofing}
      coverId={coverId}
      coverWidth={coverPhoto?.width ?? null}
      coverHeight={coverPhoto?.height ?? null}
      initialFocus={g.coverFocus}
      mobileCover={
        mobilePhoto
          ? {
              id: mobilePhoto.id,
              width: mobilePhoto.width ?? null,
              height: mobilePhoto.height ?? null,
              focus: g.coverFocusMobile ?? null,
            }
          : null
      }
      mobileNoWm={"mobileCoverNoWm" in g && g.mobileCoverNoWm === true}
      photos={photos}
      coverAuto={g.coverPhotoId === null}
      versions={s.versions}
      device={s.device}
      onDevice={s.onDevice}
      actionData={actionData}
    />
  );
}
