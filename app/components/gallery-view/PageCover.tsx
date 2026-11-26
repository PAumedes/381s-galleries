import type { RefObject } from "react";

import { useLang, useT } from "../../i18n/use-t";
import { formatEventDate } from "../../lib/event-date";
import { useStudioName } from "../../lib/use-studio-name";
import { aspectOf, coverFiles } from "../cover-files";
import { CoverHero } from "../CoverHero";
import { useImgUrl } from "../img-url";
import type { GalleryPhoto, OpenGallery } from "../types";

/** The public cover: resolves the cover photos' files, focal points and date. */
export function PageCover({
  gallery,
  photos,
  headerRef,
  onScroll,
}: {
  gallery: OpenGallery;
  photos: readonly GalleryPhoto[];
  headerRef: RefObject<HTMLElement | null>;
  onScroll: () => void;
}) {
  const t = useT();
  const imgUrl = useImgUrl();
  const lang = useLang();
  const studio = useStudioName();
  const coverPhoto = photos.find((p) => p.id === gallery.coverPhotoId);
  const coverId = coverPhoto?.id ?? gallery.coverPhotoId;
  const cover = coverId ? coverFiles(imgUrl, coverId, coverPhoto?.v) : null;
  const mobilePhoto = gallery.coverPhotoIdMobile
    ? photos.find((p) => p.id === gallery.coverPhotoIdMobile)
    : undefined;
  return (
    <CoverHero
      headerRef={headerRef}
      title={gallery.title}
      date={formatEventDate(gallery.eventDate, lang)}
      studio={studio}
      src={cover?.src ?? null}
      srcSet={cover?.srcSet}
      proofing={gallery.mode === "proofing"}
      focus={gallery.coverFocus ?? null}
      aspect={aspectOf(coverPhoto)}
      mobile={
        mobilePhoto
          ? {
              ...coverFiles(imgUrl, mobilePhoto.id, mobilePhoto.v),
              focus: gallery.coverFocusMobile ?? null,
              aspect: aspectOf(mobilePhoto),
            }
          : null
      }
      round={gallery.round ? t("gallery.round", { n: gallery.round }) : null}
      scrollLabel={t("gallery.view")}
      onScroll={onScroll}
      layout={gallery.coverLayout}
      palette={gallery.palette}
    />
  );
}
