import { Form, Link } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/t";
import type { Filter } from "../../lib/admin-gallery";
import { galleryPath } from "../../lib/gallery-path";
import type { GalleryListRow } from "../../lib/server/admin-galleries";

const STATUS_KEY = {
  published: "admin.state.published",
  draft: "admin.state.draft",
  archived: "admin.state.archived",
} as const satisfies Record<string, MessageKey>;

export function StatusPill({
  status,
  expired = false,
  proofing = false,
  className = "inline-block px-2 py-0.5",
}: {
  status: keyof typeof STATUS_KEY;
  expired?: boolean;
  /** A live proof (Prueba) gallery reads "Prueba" instead of "Publicada". */
  proofing?: boolean;
  /** Box sizing (display, padding, min height); colours and type stay fixed. */
  className?: string;
}) {
  const t = useT();
  const live = status === "published" && !expired;
  const label =
    expired && status === "published"
      ? t("admin.state.expired")
      : live && proofing
        ? t("admin.mode.proofing")
        : t(STATUS_KEY[status]);
  const tone =
    status === "published" && !expired
      ? "bg-ink text-paper border-ink"
      : "border-grey-400 text-grey-700";
  return (
    <span className={`text-micro border uppercase ${className} ${tone}`}>
      {label}
    </span>
  );
}

const COLUMNS: { key: MessageKey; cls: string; srOnly?: boolean }[] = [
  {
    key: "admin.list.col.cover",
    cls: "w-20 py-2 pr-3 font-medium",
    srOnly: true,
  },
  { key: "admin.list.col.title", cls: "py-2 pr-3 font-medium" },
  { key: "admin.list.col.date", cls: "py-2 pr-3 font-medium" },
  { key: "admin.list.col.status", cls: "py-2 pr-3 font-medium" },
  { key: "admin.list.col.photos", cls: "py-2 pr-3 text-right font-medium" },
  { key: "admin.list.col.views", cls: "py-2 pr-3 text-right font-medium" },
  { key: "admin.list.col.downloads", cls: "py-2 pr-3 text-right font-medium" },
  { key: "admin.list.col.expires", cls: "py-2 pr-3 font-medium" },
  { key: "admin.list.col.issues", cls: "py-2 font-medium" },
];

export function GalleryListHead() {
  const t = useT();
  return (
    <thead
      role="rowgroup"
      className="text-micro text-grey-600 sr-only uppercase xl:not-sr-only xl:table-header-group"
    >
      <tr role="row" className="border-grey-200 border-b">
        {COLUMNS.map((c) => (
          <th key={c.key} scope="col" role="columnheader" className={c.cls}>
            {c.srOnly ? <span className="sr-only">{t(c.key)}</span> : t(c.key)}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** Server-side `?q=` search box (keeps the status filter). */
export function SearchForm({
  filter,
  q,
  clientFilter = "",
}: {
  filter: Filter;
  q: string;
  clientFilter?: string;
}) {
  const t = useT();
  return (
    <Form
      method="get"
      action="/admin"
      role="search"
      className="flex max-w-xl items-center gap-2"
    >
      {filter !== "todas" && (
        <input type="hidden" name="estado" value={filter} />
      )}
      {clientFilter && (
        <input type="hidden" name="cliente" value={clientFilter} />
      )}
      <input
        type="search"
        name="q"
        defaultValue={q}
        maxLength={100}
        placeholder={t("admin.list.search.placeholder")}
        aria-label={t("admin.list.search.label")}
        className="border-grey-300 bg-white w-full border px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />
      <button
        type="submit"
        className="text-micro border-ink border px-4 py-2 uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {t("admin.list.search.submit")}
      </button>
    </Form>
  );
}

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
      <td
        role="cell"
        className="max-xl:col-start-1 max-xl:row-span-3 max-xl:row-start-1 xl:py-2 xl:pr-3"
      >
        {g.coverPhotoId ? (
          <img
            src={`/admin/img/${g.coverPhotoId}/thumb`}
            alt=""
            loading="lazy"
            className="bg-grey-100 h-14 w-20 object-cover"
          />
        ) : (
          <span aria-hidden="true" className="bg-grey-100 block h-14 w-20" />
        )}
      </td>
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
        {g.client && (
          <div
            data-client-folder
            className="text-ink min-w-0 truncate max-xl:text-sm"
          >
            {g.client.name}
          </div>
        )}
        {g.clientName && (
          <div className="text-grey-600 max-xl:text-sm">{g.clientName}</div>
        )}
        <div className="text-grey-600 max-xl:hidden">
          {galleryPath(g.slug, g.client?.slug)}
        </div>
      </td>
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
      <td
        role="cell"
        data-label={t("admin.list.col.photos")}
        className="tabular-nums max-xl:hidden xl:py-2 xl:pr-3 xl:text-right"
      >
        {fmt.number(g.photoCount)}
      </td>
      <td
        role="cell"
        data-label={t("admin.list.col.views")}
        className="tabular-nums max-xl:hidden xl:py-2 xl:pr-3 xl:text-right"
      >
        {fmt.number(g.views)}
      </td>
      <td
        role="cell"
        data-label={t("admin.list.col.downloads")}
        className="tabular-nums max-xl:hidden xl:py-2 xl:pr-3 xl:text-right"
      >
        {fmt.number(g.downloads)}
      </td>
      <td
        role="cell"
        data-label={t("admin.list.col.expires")}
        className="max-xl:hidden xl:py-2 xl:pr-3"
      >
        {expiry(g.expiresAt)}
      </td>
      <td
        role="cell"
        className="max-xl:col-start-3 max-xl:row-start-2 max-xl:self-center empty:hidden xl:py-2 xl:empty:table-cell"
      >
        {g.issueCount > 0 && (
          <span
            aria-label={t("admin.list.issueBadge", {
              count: g.issueCount,
            })}
            className="text-micro border-ink inline-block border px-2 py-0.5"
          >
            {fmt.number(g.issueCount)}
          </span>
        )}
      </td>
    </tr>
  );
}
