import { Form, Link, useNavigate } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import { withCode } from "../../i18n/rich";
import type { MessageKey } from "../../i18n/t";
import { SAMPLE_ROOT_NAME } from "../../lib/sample-root-name";
import { useStudioTimezone } from "../../lib/use-studio-timezone";
import { FILTERS, FILTER_KEYS, utcIsoToLocal } from "../../lib/admin-gallery";
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

/** One row on phones (360 px): tight tracking, no wrapping, sideways scroll as a fallback. */
export const FILTER_NAV_CLS =
  "flex flex-nowrap gap-0.5 overflow-x-auto md:flex-wrap md:gap-1 md:overflow-visible";
export const FILTER_CHIP_CLS =
  "text-micro flex min-h-tap shrink-0 items-center whitespace-nowrap px-1.5 uppercase max-md:tracking-wide md:min-h-0 md:px-3 md:py-2";

function filterHref(f: Filter, q: string): string {
  const p = new URLSearchParams();
  if (f !== "todas") p.set("estado", f);
  if (q) p.set("q", q);
  const qs = p.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

/** Folder layout shown to new users; folder names are literal, the notes are translated. */
function folderTree(
  t: ReturnType<typeof useT>,
  rootName: string | null | undefined,
): string {
  const rows: [string, string][] = [
    [`${rootName || SAMPLE_ROOT_NAME}/`, t("admin.list.empty.rootNote")],
    [`└─ ${t("admin.list.empty.albumName")}/`, t("admin.list.empty.albumNote")],
    ["   ├─ high-res/", t("admin.list.empty.highresNote")],
    ["   ├─ web/", "1200 px"],
    ["   ├─ ig/", t("admin.list.empty.igNote")],
    ["   ├─ thumb/", "600 px"],
    ["   └─ preview-wm/", t("admin.list.empty.wmNote")],
  ];
  return rows.map(([dir, note]) => `${dir.padEnd(29)}${note}`).join("\n");
}

function EmptyLibrary({ rootName }: { rootName?: string | null }) {
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
        {folderTree(t, rootName)}
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
  rootName,
}: {
  galleries: GalleryListItem[];
  filter: Filter;
  total: number;
  /** Current search text (server-side `?q=`). */
  q?: string;
  /** Saved Drive root folder name (settings); a neutral sample when unset. */
  rootName?: string | null;
}) {
  const navigate = useNavigate();
  const t = useT();
  const fmt = useFormat();
  const tz = useStudioTimezone();
  const expiry = (iso: string | null) => {
    if (!iso) return t("admin.list.noExpiry");
    const l = utcIsoToLocal(iso, tz);
    return l ? fmt.localDateTime(l.date, l.time) : "—";
  };
  if (total === 0 && galleries.length === 0)
    return <EmptyLibrary rootName={rootName} />;
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
      <nav aria-label={t("admin.filter.label")} className={FILTER_NAV_CLS}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            to={filterHref(f, q)}
            aria-current={f === filter ? "page" : undefined}
            className={`${FILTER_CHIP_CLS} ${f === filter ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`}
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
                  className="border-grey-100 hover:bg-grey-50 grid cursor-pointer grid-cols-[5rem_1fr_auto] gap-x-3 gap-y-1 border-b py-3 max-xl:relative max-xl:py-4 xl:table-row xl:py-0"
                >
                  <td role="cell" className="max-xl:col-start-1 max-xl:row-span-3 max-xl:row-start-1 xl:py-2 xl:pr-3">
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
                    className="min-w-0 max-xl:col-span-2 max-xl:col-start-2 max-xl:row-start-1 xl:table-cell xl:py-2 xl:pr-3"
                  >
                    <Link
                      to={`/admin/g/${g.id}`}
                      className="text-body text-ink block font-medium underline-offset-4 hover:underline max-xl:line-clamp-2 max-xl:text-base max-xl:font-bold max-xl:after:absolute max-xl:after:inset-0 xl:inline"
                    >
                      {g.title}
                    </Link>
                    {g.clientName && (
                      <div className="text-grey-600 max-xl:text-sm">
                        {g.clientName}
                      </div>
                    )}
                    <div className="text-grey-600 max-xl:hidden">/{g.slug}</div>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
