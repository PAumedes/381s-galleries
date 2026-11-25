import { Form } from "react-router";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/t";
import type { Filter } from "../../lib/admin-gallery";

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
