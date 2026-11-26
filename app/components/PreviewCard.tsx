import type { TFunction } from "../i18n/t";
import { formatBytes } from "../lib/format-bytes";
import { Download } from "./icons";
import type { GalleryPhoto } from "./types";

/** `312 MB`, or nothing when the size is not known. */
const sizeOf = (photo: GalleryPhoto) =>
  photo.tiff?.bytes ? formatBytes(photo.tiff.bytes) : null;

/**
 * What stands in for the picture of a photo that has none to show (T6.53d: a
 * TIFF-only photo, which browsers cannot display): "Vista previa no
 * disponible", the file name and size. Text only; the caller wraps it in the
 * tile's open button or the lightbox stage and adds the download button.
 */
export function PreviewCardText({
  t,
  photo,
  compact = false,
}: {
  t: TFunction;
  photo: GalleryPhoto;
  compact?: boolean;
}) {
  const size = sizeOf(photo);
  return (
    <span
      className={`flex w-full min-w-0 flex-col items-center gap-1 px-3 text-center ${
        compact ? "text-micro" : "text-small gap-2"
      }`}
    >
      <span className="text-micro-label uppercase opacity-70">
        {t("preview.tiff")}
      </span>
      <span className={compact ? "font-medium" : "text-base font-medium"}>
        {t("preview.unavailable")}
      </span>
      {photo.tiff && (
        <span className="max-w-full truncate opacity-70" dir="auto">
          {photo.tiff.name}
        </span>
      )}
      {size && <span className="opacity-70 tabular-nums">{size}</span>}
    </span>
  );
}

/** The download button of a placeholder: the original TIFF through the usual download sheet. */
export function PreviewDownload({
  t,
  photoId,
  onDownload,
  className,
  iconOnly = false,
}: {
  t: TFunction;
  photoId: string;
  onDownload: (id: string) => void;
  className: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={t("preview.download")}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onDownload(photoId);
      }}
    >
      <Download className="size-5" aria-hidden="true" />
      {!iconOnly && <span>{t("preview.download")}</span>}
    </button>
  );
}
