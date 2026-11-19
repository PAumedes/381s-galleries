import { LivePreview } from "../LivePreview";
import { aspectOf } from "./cover";
import type {
  EditGallery,
  EditorCover,
  GalleryEditData,
  PreviewState,
} from "./types";

/** The live preview column shared by the Datos, Diseño and Compartir tabs. */
export function EditorPreview({
  g,
  photos,
  cover: { coverId, coverPhoto, mobilePhoto },
  state: s,
  heading,
  hint,
  footer,
}: {
  g: EditGallery;
  photos: GalleryEditData["photos"];
  cover: EditorCover;
  state: PreviewState;
  heading: string;
  hint: string;
  footer?: React.ReactNode;
}) {
  return (
    <LivePreview
      heading={heading}
      hint={hint}
      title={s.title}
      eventDate={s.eventDate || null}
      palette={s.design.palette}
      coverLayout={s.design.coverLayout}
      gridStyle={s.design.gridStyle}
      gridGap={s.design.gridGap}
      proofing={s.proofing}
      cover={
        coverId
          ? { id: coverId, aspect: aspectOf(coverPhoto), focus: g.coverFocus }
          : null
      }
      mobileCover={
        mobilePhoto
          ? {
              id: mobilePhoto.id,
              aspect: aspectOf(mobilePhoto),
              focus: g.coverFocusMobile ?? null,
            }
          : null
      }
      photos={photos}
      versions={s.versions}
      device={s.device}
      onDevice={s.onDevice}
    >
      {footer}
    </LivePreview>
  );
}
