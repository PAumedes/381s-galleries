import type { GalleryStatus } from "../../lib/constants";
import { useMemo } from "react";
import { useSearchParams } from "react-router";

import { useT } from "../../i18n/use-t";
import {
  DEVICE_PARAM,
  editorHref,
  resolveDevice,
} from "../../lib/preview-device";
import { useIsClient } from "../../lib/use-is-client";
import { GalleryView } from "../GalleryView";
import { adminImgUrl, ImgUrlProvider } from "../img-url";
import type { GalleryPhoto, OpenGallery } from "../types";
import { isEditorTab } from "./GalleryTabs";

export type AdminPreviewData = {
  id: string;
  status: GalleryStatus;
  hasPin: boolean;
  expired: boolean;
  gallery: OpenGallery;
  photos: GalleryPhoto[];
};

/**
 * "Vista previa": the real client gallery (same GalleryView, palette, cover,
 * grid and lightbox) for the owner, in any state. A bar on top (16px text, 48px button; on phones
 * centered text above a full-width button, from `sm` one row; in the page flow so it covers nothing) says it is a preview and
 * links back to the editor, keeping its device and tab; images come from `/admin/img`.
 */
export function AdminGalleryPreview({ data }: { data: AdminPreviewData }) {
  const t = useT();
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const param = params.get(DEVICE_PARAM);
  // "Volver al editor" returns to the device and tab this page was opened
  // from (known only in the browser, so it appears right after hydration).
  const device = useIsClient() ? resolveDevice(param) : undefined;
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
        className="bg-ink text-paper flex flex-col items-center gap-3 px-4 py-3 text-center text-base sm:flex-row sm:justify-between sm:text-start"
      >
        <p className="min-w-0 sm:flex-1">
          {t("admin.preview.bar")}
          {notes.length > 0 && (
            <span className="opacity-80"> · {notes.join(" · ")}</span>
          )}
        </p>
        <a
          href={editorHref(data.id, device, isEditorTab(tab) ? tab : undefined)}
          className="border-paper flex min-h-12 w-full items-center justify-center border px-5 sm:w-auto underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
        >
          {t("admin.preview.back")}
        </a>
      </div>
      <GalleryView gallery={data.gallery} photos={data.photos} preview />
    </ImgUrlProvider>
  );
}
