import { useMemo } from "react";

import { useT } from "../../i18n/use-t";
import { GalleryView } from "../GalleryView";
import { adminImgUrl, ImgUrlProvider } from "../img-url";
import type { GalleryPhoto, OpenGallery } from "../types";

export type AdminPreviewData = {
  id: string;
  status: "draft" | "published" | "archived";
  hasPin: boolean;
  expired: boolean;
  gallery: OpenGallery;
  photos: GalleryPhoto[];
};

/**
 * "Vista previa": the real client gallery (same GalleryView, palette, cover,
 * grid and lightbox) for the owner, in any state. A slim bar on top says it
 * is a preview and links back to the editor; images come from `/admin/img`.
 */
export function AdminGalleryPreview({ data }: { data: AdminPreviewData }) {
  const t = useT();
  const proofing = data.gallery.mode === "proofing";
  const url = useMemo(() => adminImgUrl(proofing), [proofing]);
  const notes = [
    data.status === "draft" && t("admin.state.draft"),
    data.status === "archived" && t("admin.state.archived"),
    data.expired && t("admin.state.expired"),
    data.hasPin && t("admin.preview.withPin"),
    proofing && t("admin.mode.proofing"),
  ].filter(Boolean);
  return (
    <ImgUrlProvider value={url}>
      <div
        data-admin-preview-bar=""
        className="bg-ink text-paper text-micro flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 uppercase"
      >
        <p>
          {t("admin.preview.bar")}
          {notes.length > 0 && (
            <span className="opacity-80"> · {notes.join(" · ")}</span>
          )}
        </p>
        <a
          href={`/admin/g/${encodeURIComponent(data.id)}`}
          className="flex min-h-tap items-center underline-offset-4 hover:underline md:min-h-0"
        >
          {t("admin.preview.back")}
        </a>
      </div>
      <GalleryView gallery={data.gallery} photos={data.photos} preview />
    </ImgUrlProvider>
  );
}
