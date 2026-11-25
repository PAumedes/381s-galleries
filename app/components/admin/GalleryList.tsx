import { Link, useNavigate } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import { withCode } from "../../i18n/rich";
import { SAMPLE_ROOT_NAME } from "../../lib/sample-root-name";
import { useStudioTimezone } from "../../lib/use-studio-timezone";
import { FILTERS, FILTER_KEYS, utcIsoToLocal } from "../../lib/admin-gallery";
import type { Filter } from "../../lib/admin-gallery";
import type { GalleryListRow } from "../../lib/server/admin-galleries";
import { ClientFilter } from "./ClientFilter";
import type { ClientChoice } from "../../lib/server/admin-galleries/client-choices";
import { GalleryRow } from "./GalleryRow";
import { GalleryListHead, SearchForm, StatusPill } from "./GalleryListParts";

export { StatusPill };

export type GalleryListItem = GalleryListRow;

/** One row on phones (360 px): tight tracking, no wrapping, sideways scroll as a fallback. */
export const FILTER_NAV_CLS =
  "flex flex-nowrap gap-0.5 overflow-x-auto md:flex-wrap md:gap-1 md:overflow-visible";
export const FILTER_CHIP_CLS =
  "text-micro flex min-h-tap shrink-0 items-center whitespace-nowrap px-1.5 uppercase max-md:tracking-wide md:min-h-0 md:px-3 md:py-2";

function filterHref(f: Filter, q: string, client = ""): string {
  const p = new URLSearchParams();
  if (f !== "todas") p.set("estado", f);
  if (q) p.set("q", q);
  if (client) p.set("cliente", client);
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

interface GalleryListProps {
  galleries: GalleryListItem[];
  filter: Filter;
  total: number;
  /** Current search text (server-side `?q=`). */
  q?: string;
  /** Saved Drive root folder name (settings); a neutral sample when unset. */
  rootName?: string | null;
  /** Current `?cliente=` value: "" (all), "none" or a client id. */
  clientFilter?: string;
  /** Clients for the filter select (at most 100). */
  clients?: ClientChoice[];
}

/** Status filter chips, keeping the search and client filter. */
function FilterChips({
  filter,
  q,
  clientFilter,
}: {
  filter: Filter;
  q: string;
  clientFilter: string;
}) {
  const t = useT();
  return (
    <nav aria-label={t("admin.filter.label")} className={FILTER_NAV_CLS}>
      {FILTERS.map((f) => (
        <Link
          key={f}
          to={filterHref(f, q, clientFilter)}
          aria-current={f === filter ? "page" : undefined}
          className={`${FILTER_CHIP_CLS} ${f === filter ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`}
        >
          {t(FILTER_KEYS[f])}
        </Link>
      ))}
    </nav>
  );
}

export function GalleryList(props: GalleryListProps) {
  const { galleries, filter, total, q = "", rootName } = props;
  const { clientFilter = "", clients = [] } = props;
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
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchForm filter={filter} q={q} clientFilter={clientFilter} />
        {(clients.length > 0 || clientFilter) && (
          <ClientFilter
            clients={clients}
            value={clientFilter}
            hrefFor={(c) => filterHref(filter, q, c)}
          />
        )}
      </div>
      <FilterChips filter={filter} q={q} clientFilter={clientFilter} />
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
            <GalleryListHead />
            <tbody role="rowgroup" className="block xl:table-row-group">
              {galleries.map((g) => (
                <GalleryRow
                  key={g.id}
                  g={g}
                  onOpen={() => void navigate(`/admin/g/${g.id}`)}
                  expiry={expiry}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
