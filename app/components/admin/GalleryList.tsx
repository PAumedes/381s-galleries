import { Form, Link, useNavigate } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import { withCode } from "../../i18n/rich";
import type { MessageKey } from "../../i18n/t";
import { FILTERS, FILTER_KEYS, utcIsoToBaLocal } from "../../lib/admin-gallery";
import type { Filter } from "../../lib/admin-gallery";
import type { GalleryListRow } from "../../lib/server/admin-galleries";

export type GalleryListItem = GalleryListRow;

const STATUS_KEY = {
  published: "admin.state.published",
  draft: "admin.state.draft",
  archived: "admin.state.archived",
} as const satisfies Record<string, MessageKey>;

export function StatusPill({
  status,
  expired = false,
}: {
  status: keyof typeof STATUS_KEY;
  expired?: boolean;
}) {
  const t = useT();
  const label =
    expired && status === "published"
      ? t("admin.state.expired")
      : t(STATUS_KEY[status]);
  const tone =
    status === "published" && !expired
      ? "bg-ink text-paper border-ink"
      : "border-grey-400 text-grey-700";
  return (
    <span
      className={`text-micro inline-block border px-2 py-0.5 uppercase ${tone}`}
    >
      {label}
    </span>
  );
}

function filterHref(f: Filter, q: string): string {
  const p = new URLSearchParams();
  if (f !== "todas") p.set("estado", f);
  if (q) p.set("q", q);
  const qs = p.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

/** Folder layout shown to new users; folder names are literal, the notes are translated. */
function folderTree(t: ReturnType<typeof useT>): string {
  const rows: [string, string][] = [
    ["381studios/", t("admin.list.empty.rootNote")],
    [`└─ ${t("admin.list.empty.albumName")}/`, t("admin.list.empty.albumNote")],
    ["   ├─ high-res/", t("admin.list.empty.highresNote")],
    ["   ├─ web/", "1200 px"],
    ["   ├─ ig/", t("admin.list.empty.igNote")],
    ["   ├─ thumb/", "600 px"],
    ["   └─ preview-wm/", t("admin.list.empty.wmNote")],
  ];
  return rows.map(([dir, note]) => `${dir.padEnd(29)}${note}`).join("\n");
}

function EmptyLibrary() {
  const t = useT();
  return (
    <div className="border-grey-200 flex max-w-2xl flex-col gap-4 border p-6">
      <h2 className="text-micro text-grey-700 uppercase">
        {t("admin.list.empty.title")}
      </h2>
      <p className="text-body">
        {t("admin.list.empty.intro")}{" "}
        <Link to="/admin/setup" className="underline">
          {t("admin.nav.settings")}
        </Link>
        .
      </p>
      <pre className="bg-grey-50 text-small overflow-x-auto p-4 leading-6">
        {folderTree(t)}
      </pre>
      <p className="text-small text-grey-600">
        {withCode(t("admin.list.empty.sets"))}
      </p>
    </div>
  );
}

export function GalleryList({
  galleries,
  filter,
  total,
  q = "",
}: {
  galleries: GalleryListItem[];
  filter: Filter;
  total: number;
  /** Current search text (server-side `?q=`). */
  q?: string;
}) {
  const navigate = useNavigate();
  const t = useT();
  const fmt = useFormat();
  const expiry = (iso: string | null) => {
    if (!iso) return t("admin.list.noExpiry");
    const l = utcIsoToBaLocal(iso);
    return l ? fmt.localDateTime(l.date, l.time) : "—";
  };
  if (total === 0 && galleries.length === 0) return <EmptyLibrary />;
  return (
    <div className="flex flex-col gap-4">
      <Form
        method="get"
        action="/admin"
        role="search"
        className="flex max-w-xl items-center gap-2"
      >
        {filter !== "todas" && (
          <input type="hidden" name="estado" value={filter} />
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
      <nav
        aria-label={t("admin.filter.label")}
        className="flex flex-wrap gap-1"
      >
        {FILTERS.map((f) => (
          <Link
            key={f}
            to={filterHref(f, q)}
            aria-current={f === filter ? "page" : undefined}
            className={`text-micro flex min-h-tap items-center px-3 uppercase md:min-h-0 md:py-2 ${f === filter ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`}
          >
            {t(FILTER_KEYS[f])}
          </Link>
        ))}
      </nav>
      {galleries.length === 0 ? (
        <p className="text-body text-grey-600">
          {q ? t("admin.list.noMatch") : t("admin.list.noneInFilter")}
        </p>
      ) : (
        <div className="xl:overflow-x-auto">
          <table
            role="table"
            className="text-small block w-full text-left xl:table xl:min-w-[56rem]"
          >
            <thead
              role="rowgroup"
              className="text-micro text-grey-600 sr-only uppercase xl:not-sr-only xl:table-header-group"
            >
              <tr role="row" className="border-grey-200 border-b">
                <th
                  scope="col"
                  role="columnheader"
                  className="w-20 py-2 pr-3 font-medium"
                >
                  <span className="sr-only">{t("admin.list.col.cover")}</span>
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 font-medium"
                >
                  {t("admin.list.col.title")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 font-medium"
                >
                  {t("admin.list.col.date")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 font-medium"
                >
                  {t("admin.list.col.status")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 text-right font-medium"
                >
                  {t("admin.list.col.photos")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 text-right font-medium"
                >
                  {t("admin.list.col.views")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 text-right font-medium"
                >
                  {t("admin.list.col.downloads")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 pr-3 font-medium"
                >
                  {t("admin.list.col.expires")}
                </th>
                <th
                  scope="col"
                  role="columnheader"
                  className="py-2 font-medium"
                >
                  {t("admin.list.col.issues")}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="block xl:table-row-group">
              {galleries.map((g) => (
                <tr
                  key={g.id}
                  role="row"
                  onClick={(ev) => {
                    if (!(ev.target as HTMLElement).closest("a"))
                      void navigate(`/admin/g/${g.id}`);
                  }}
                  className="border-grey-100 hover:bg-grey-50 grid cursor-pointer grid-cols-3 gap-x-3 gap-y-1 border-b py-3 xl:table-row xl:py-0"
                >
                  <td role="cell" className="xl:py-2 xl:pr-3">
                    {g.coverPhotoId ? (
                      <img
                        src={`/admin/img/${g.coverPhotoId}/thumb`}
                        alt=""
                        loading="lazy"
                        className="bg-grey-100 h-14 w-20 object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="bg-grey-100 block h-14 w-20"
                      />
                    )}
                  </td>
                  <td
                    role="cell"
                    className="col-span-2 min-w-0 xl:table-cell xl:py-2 xl:pr-3"
                  >
                    <Link
                      to={`/admin/g/${g.id}`}
                      className="text-body text-ink flex min-h-tap items-center font-medium underline-offset-4 hover:underline xl:inline xl:min-h-0"
                    >
                      {g.title}
                    </Link>
                    {g.clientName && (
                      <div className="text-grey-600">{g.clientName}</div>
                    )}
                    <div className="text-grey-600">/{g.slug}</div>
                  </td>
                  <td
                    role="cell"
                    data-label={t("admin.list.col.date")}
                    className={`row-start-2 before:text-micro before:text-grey-600 before:block before:uppercase before:content-[attr(data-label)] xl:before:hidden xl:py-2 xl:pr-3`}
                  >
                    {g.eventDate ? fmt.date(g.eventDate) : "—"}
                  </td>
                  <td
                    role="cell"
                    data-label={t("admin.list.col.status")}
                    className={`row-start-2 before:text-micro before:text-grey-600 before:block before:uppercase before:content-[attr(data-label)] xl:before:hidden xl:py-2 xl:pr-3`}
                  >
                    <StatusPill status={g.status} expired={g.expired} />
                    {g.deleting && (
                      <Link
                        to={`/admin/g/${g.id}`}
                        className="text-micro mt-1 block underline"
                      >
                        {t("admin.list.deleting")}
                      </Link>
                    )}
                  </td>
                  <td
                    role="cell"
                    data-label={t("admin.list.col.photos")}
                    className={`row-start-3 before:text-micro before:text-grey-600 before:block before:uppercase before:content-[attr(data-label)] xl:before:hidden tabular-nums xl:py-2 xl:pr-3 xl:text-right`}
                  >
                    {fmt.number(g.photoCount)}
                  </td>
                  <td
                    role="cell"
                    data-label={t("admin.list.col.views")}
                    className={`row-start-3 before:text-micro before:text-grey-600 before:block before:uppercase before:content-[attr(data-label)] xl:before:hidden tabular-nums xl:py-2 xl:pr-3 xl:text-right`}
                  >
                    {fmt.number(g.views)}
                  </td>
                  <td
                    role="cell"
                    data-label={t("admin.list.col.downloads")}
                    className={`row-start-3 before:text-micro before:text-grey-600 before:block before:uppercase before:content-[attr(data-label)] xl:before:hidden tabular-nums xl:py-2 xl:pr-3 xl:text-right`}
                  >
                    {fmt.number(g.downloads)}
                  </td>
                  <td
                    role="cell"
                    data-label={t("admin.list.col.expires")}
                    className={`row-start-4 before:text-micro before:text-grey-600 before:block before:uppercase before:content-[attr(data-label)] xl:before:hidden col-span-3 xl:py-2 xl:pr-3`}
                  >
                    {expiry(g.expiresAt)}
                  </td>
                  <td
                    role="cell"
                    className="col-start-3 row-start-2 empty:hidden xl:py-2 xl:empty:table-cell"
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
