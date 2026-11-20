import { Link } from "react-router";

import type { PreviewDevice } from "../../../lib/preview-device";
import { previewHref } from "../../../lib/preview-device";
import { useT } from "../../../i18n/use-t";
import { External } from "../../icons";
import { StatusPill } from "../GalleryList";
import type { EditGallery } from "./types";
import { btn } from "./ui";

/** Back link, title, status pill and the "preview as client" link. */
export function EditorHeader({
  g,
  device,
  tab,
}: {
  g: EditGallery;
  device: PreviewDevice;
  tab: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Link
        to="/admin"
        className="text-micro text-grey-700 hover:text-ink flex min-h-tap items-center uppercase md:min-h-0"
      >
        {t("admin.backToGalleries")}
      </Link>
      <h1 className="text-title text-ink min-w-0 break-words">{g.title}</h1>
      <StatusPill status={g.status} />
      <a
        href={previewHref(g.id, device, tab)}
        target="_blank"
        rel="noopener noreferrer"
        title={t("admin.edit.previewHint")}
        className={`${btn} ml-auto flex items-center gap-2`}
      >
        <External aria-hidden="true" className="size-4" />
        {t("admin.edit.preview")}
      </a>
    </div>
  );
}
