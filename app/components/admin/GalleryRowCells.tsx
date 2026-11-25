import { Link } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import { galleryPath } from "../../lib/gallery-path";
import type { GalleryListRow } from "../../lib/server/admin-galleries";
import { StatusPill } from "./GalleryListParts";

/** Thumbnail of the cover (or an empty box). */
export function CoverCell({ coverPhotoId }: { coverPhotoId: string | null }) {
  return (
    <td
      role="cell"
      className="max-xl:col-start-1 max-xl:row-span-3 max-xl:row-start-1 xl:py-2 xl:pr-3"
    >
      {coverPhotoId ? (
        <img
          src={`/admin/img/${coverPhotoId}/thumb`}
          alt=""
          loading="lazy"
          className="bg-grey-100 h-14 w-20 object-cover"
        />
      ) : (
        <span aria-hidden="true" className="bg-grey-100 block h-14 w-20" />
      )}
    </td>
  );
}

/** Title link, client and public address. */
export function TitleCell({ g }: { g: GalleryListRow }) {
  return (
    <td
      role="cell"
      className="min-w-0 max-xl:col-span-2 max-xl:col-start-2 max-xl:row-start-1 xl:table-cell xl:py-2 xl:pr-3"
    >
      <Link
        to={`/admin/g/${g.id}`}
        className="text-body text-ink block font-medium underline-offset-4 hover:underline max-xl:line-clamp-2 max-xl:text-base max-xl:font-bold max-xl:after:absolute max-xl:after:inset-0 xl:inline"
      >
        {g.title}
      </Link>
      {g.client ? (
        <div
          data-client-folder
          className="text-ink min-w-0 truncate max-xl:text-sm"
        >
          {g.client.name}
        </div>
      ) : (
        g.clientName && (
          // legacy free text, shown only while no client folder is assigned
          <div className="text-grey-600 max-xl:text-sm">{g.clientName}</div>
        )
      )}
      <div className="text-grey-600 max-xl:hidden">
        {galleryPath(g.slug, g.client?.slug)}
      </div>
    </td>
  );
}

/** Status pill, plus the "continue deleting" link while a deletion is unfinished. */
export function StatusCell({ g }: { g: GalleryListRow }) {
  const t = useT();
  return (
    <td
      role="cell"
      data-label={t("admin.list.col.status")}
      className="max-xl:col-start-2 max-xl:row-start-2 xl:py-2 xl:pr-3"
    >
      <StatusPill
        status={g.status}
        expired={g.expired}
        proofing={g.mode === "proofing"}
      />
      {g.deleting && (
        <Link
          to={`/admin/g/${g.id}`}
          className="text-micro relative z-10 mt-1 block underline"
        >
          {t("admin.list.deleting")}
        </Link>
      )}
    </td>
  );
}

/** A right-aligned counter column (desktop only). */
export function CountCell({ label, value }: { label: string; value: number }) {
  const fmt = useFormat();
  return (
    <td
      role="cell"
      data-label={label}
      className="tabular-nums max-xl:hidden xl:py-2 xl:pr-3 xl:text-right"
    >
      {fmt.number(value)}
    </td>
  );
}

/** Badge with the number of sync issues (empty cell when none). */
export function IssueCell({ count }: { count: number }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <td
      role="cell"
      className="max-xl:col-start-3 max-xl:row-start-2 max-xl:self-center empty:hidden xl:py-2 xl:empty:table-cell"
    >
      {count > 0 && (
        <span
          aria-label={t("admin.list.issueBadge", { count })}
          className="text-micro border-ink inline-block border px-2 py-0.5"
        >
          {fmt.number(count)}
        </span>
      )}
    </td>
  );
}
