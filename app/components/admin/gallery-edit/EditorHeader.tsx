import { Link } from "react-router";

import { useT } from "../../../i18n/use-t";
import { External } from "../../icons";
import { StatusPill } from "../GalleryList";
import type { EditGallery } from "./types";
import { btn } from "./ui";

/** Back link, title, status pill and the "preview as client" link. */
export function EditorHeader({ g }: { g: EditGallery }) {
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
        href={`/admin/g/${encodeURIComponent(g.id)}/preview`}
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
