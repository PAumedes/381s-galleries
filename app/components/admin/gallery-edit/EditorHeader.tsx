import { Link } from "react-router";

import type { PreviewDevice } from "../../../lib/preview-device";
import { previewHref } from "../../../lib/preview-device";
import { useT } from "../../../i18n/use-t";
import { External } from "../../icons";
import { StatusPill } from "../GalleryList";
import type { EditGallery } from "./types";

/** Phones: status and preview are a two-column grid; from md they flow inline. */
export const HEADER_ACTIONS_CLS =
  "grid basis-full grid-cols-2 gap-2 md:ml-auto md:flex md:basis-auto md:items-center";
/** Same box for both: 48px tall, centred, same type (the pill adds its own colours). */
export const HEADER_ACTION_CLS =
  "flex min-h-12 items-center justify-center gap-2 px-4";

/** Back link (own row on phones), title, then status pill + "preview as client" link. */
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
        className="text-micro text-grey-700 hover:text-ink flex min-h-tap basis-full items-center uppercase md:min-h-0 md:basis-auto"
      >
        {t("admin.backToGalleries")}
      </Link>
      <h1 className="text-title text-ink min-w-0 basis-full break-words md:basis-auto">
        {g.title}
      </h1>
      <div className={HEADER_ACTIONS_CLS}>
        <StatusPill
          status={g.status}
          className={`${HEADER_ACTION_CLS} md:inline-block md:min-h-0 md:px-2 md:py-0.5`}
        />
        <a
          href={previewHref(g.id, device, tab)}
          target="_blank"
          rel="noopener noreferrer"
          title={t("admin.edit.previewHint")}
          className={`${HEADER_ACTION_CLS} text-micro border-ink border uppercase md:min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`}
        >
          <External aria-hidden="true" className="size-4" />
          {t("admin.edit.preview")}
        </a>
      </div>
    </div>
  );
}
