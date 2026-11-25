import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import type { GalleryListRow } from "../../lib/server/admin-galleries";
import {
  CountCell,
  CoverCell,
  IssueCell,
  StatusCell,
  TitleCell,
} from "./GalleryRowCells";

/** One gallery: a table row on desktop, a card on phones. */
export function GalleryRow({
  g,
  onOpen,
  expiry,
}: {
  g: GalleryListRow;
  onOpen: () => void;
  expiry: (iso: string | null) => string;
}) {
  const t = useT();
  const fmt = useFormat();
  return (
    <tr
      role="row"
      onClick={(ev) => {
        if (!(ev.target as HTMLElement).closest("a")) onOpen();
      }}
      className="border-grey-100 hover:bg-grey-50 grid cursor-pointer grid-cols-[5rem_1fr_auto] gap-x-3 gap-y-1 border-b py-3 max-xl:relative max-xl:py-4 xl:table-row xl:py-0"
    >
      <CoverCell coverPhotoId={g.coverPhotoId} />
      <TitleCell g={g} />
      <StatusCell g={g} />
      <td
        role="cell"
        data-label={t("admin.list.col.date")}
        className="max-xl:text-grey-600 max-xl:col-span-2 max-xl:col-start-2 max-xl:row-start-3 max-xl:text-sm xl:py-2 xl:pr-3"
      >
        {g.eventDate ? fmt.date(g.eventDate) : "—"}
        <span className="xl:hidden">
          {" · "}
          {t("admin.count.photos", { count: g.photoCount })}
        </span>
      </td>
      <CountCell label={t("admin.list.col.photos")} value={g.photoCount} />
      <CountCell label={t("admin.list.col.views")} value={g.views} />
      <CountCell label={t("admin.list.col.downloads")} value={g.downloads} />
      <td
        role="cell"
        data-label={t("admin.list.col.expires")}
        className="max-xl:hidden xl:py-2 xl:pr-3"
      >
        {expiry(g.expiresAt)}
      </td>
      <IssueCell count={g.issueCount} />
    </tr>
  );
}
