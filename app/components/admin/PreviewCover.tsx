import { localeFor } from "../../i18n/format";
import { useT, useLang } from "../../i18n/use-t";
import type { CoverLayout, Palette } from "../../lib/design";
import { formatEventDate } from "../../lib/event-date";
import type { PreviewDevice } from "../../lib/preview-device";
import { useStudioName } from "../../lib/use-studio-name";
import { CoverHero } from "../CoverHero";
import { adminImgSrc, type Versions } from "../img-url";
import type { CoverSpec } from "./LivePreview";

/** Admin URL of the cover image (the watermarked one in Prueba). */
export const coverSrc = (id: string, proofing: boolean, v?: string | null) =>
  adminImgSrc(id, proofing ? "view-sm-wm" : "view-sm", v);

/**
 * Small stand-in shown while the cover loads: the thumbnail (the watermarked
 * one in Prueba, never a clean file there). The photo grid and the cover
 * chooser load the same URL, so the browser has it already.
 */
export const coverPlaceholderSrc = (
  id: string,
  proofing: boolean,
  v?: string | null,
) => adminImgSrc(id, proofing ? "thumb-wm" : "thumb", v);

type PreviewCoverProps = {
  cover: CoverSpec | null;
  mobileCover: CoverSpec | null;
  preview: {
    title: string;
    eventDate: string | null;
    palette: Palette;
    coverLayout: CoverLayout;
    proofing: boolean;
    versions?: Versions;
    device: PreviewDevice;
  };
};

/** The real `CoverHero` in its inert, embedded flavour, fed by unsaved form values. */
export function PreviewCover({
  cover,
  mobileCover,
  preview: {
    title,
    eventDate,
    palette,
    coverLayout,
    proofing,
    versions,
    device,
  },
}: PreviewCoverProps) {
  const t = useT();
  const lang = useLang();
  const studio = useStudioName();
  return (
    <CoverHero
      embedded
      layout={coverLayout}
      palette={palette}
      title={title}
      date={formatEventDate(eventDate, localeFor(lang))}
      studio={studio}
      src={cover ? coverSrc(cover.id, proofing, versions?.[cover.id]) : null}
      placeholder={
        cover
          ? coverPlaceholderSrc(cover.id, proofing, versions?.[cover.id])
          : null
      }
      proofing={false}
      focus={cover?.focus ?? null}
      aspect={cover?.aspect ?? null}
      mobile={
        mobileCover
          ? {
              src: coverSrc(
                mobileCover.id,
                proofing,
                versions?.[mobileCover.id],
              ),
              placeholder: coverPlaceholderSrc(
                mobileCover.id,
                proofing,
                versions?.[mobileCover.id],
              ),
              focus: mobileCover.focus,
              aspect: mobileCover.aspect,
            }
          : null
      }
      device={device}
      scrollLabel={t("gallery.view")}
    />
  );
}
