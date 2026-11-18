import { useState } from "react";
import { Form, Link } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import {
  DEVICE_KEYS,
  SIZE_KEYS,
  bulkTitle,
  placeLabel,
  softwareLabel,
  sourceLabel,
  type VisitorDisplay,
} from "../../lib/admin-activity";
import type { loadActivity } from "../../lib/server/admin-activity";
import { GalleryTabs } from "./GalleryTabs";

export type ActivityViewData = NonNullable<
  Awaited<ReturnType<typeof loadActivity>>
>;
type Row = ActivityViewData["rows"][number];

const th = "text-micro text-grey-700 px-3 py-2 text-left font-medium uppercase";
// Below md every row is a card: cells stack and carry their column name (T6.11).
const td =
  "block px-3 py-1 text-small before:text-micro before:text-grey-700 before:block before:uppercase before:content-[attr(data-label)] md:table-cell md:py-2 md:align-middle md:before:hidden";
const rowCls = "border-grey-200 block border-t py-2 md:table-row md:py-0";
const tableCls = "block w-full text-left md:table md:min-w-[56rem]";
const headCls = "sr-only md:not-sr-only md:table-header-group";
const selectCls =
  "border-grey-300 bg-white border px-3 py-2 text-small focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function Card({ label, value }: { label: string; value: number }) {
  const { number } = useFormat();
  return (
    <div className="border-grey-200 flex flex-col gap-1 border p-4">
      <p className="text-micro text-grey-700 uppercase">{label}</p>
      <p className="text-title text-ink">{number(value)}</p>
    </div>
  );
}

function Who({ email }: { email: string | null }) {
  const t = useT();
  return email ? (
    <>{email}</>
  ) : (
    <span className="text-grey-700">{t("admin.anon")}</span>
  );
}

function PhotoCell({ r }: { r: Row }) {
  const t = useT();
  if (!r.photoId) return <span className="text-grey-700">—</span>;
  return (
    <span className="flex items-center gap-3">
      <img
        src={`/admin/img/${r.photoId}/thumb`}
        alt={r.name ?? ""}
        loading="lazy"
        className="bg-grey-200 h-10 w-10 object-cover"
      />
      <span>{r.name ?? t("admin.photoDeleted")}</span>
    </span>
  );
}

/** Place, device and source cells shared by download rows and visit rows. */
function VisitorCells({ x }: { x: VisitorDisplay }) {
  const t = useT();
  const device =
    x.device && Object.hasOwn(DEVICE_KEYS, x.device)
      ? t(DEVICE_KEYS[x.device]!)
      : null;
  const software = softwareLabel(x);
  return (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.place")}>
        {placeLabel(x) || "—"}
      </td>
      <td
        role="cell"
        className={td}
        data-label={t("admin.activity.col.device")}
      >
        {device || software ? (
          <>
            {device}
            {device && software ? <br /> : null}
            <span className="text-grey-700">{software}</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td
        role="cell"
        className={td}
        data-label={t("admin.activity.col.source")}
      >
        {sourceLabel(x) || "—"}
      </td>
    </>
  );
}

function Breakdown({ data }: { data: ActivityViewData["breakdown"] }) {
  const t = useT();
  const { number } = useFormat();
  const groups = [
    ["countries", "admin.activity.breakdown.countries"],
    ["devices", "admin.activity.breakdown.devices"],
    ["browsers", "admin.activity.breakdown.browsers"],
    ["referrers", "admin.activity.breakdown.referrers"],
  ] as const;
  const label = (key: string, value: string) =>
    key === "devices" && Object.hasOwn(DEVICE_KEYS, value)
      ? t(DEVICE_KEYS[value]!)
      : value;
  return (
    <section aria-labelledby="breakdown-title" className="flex flex-col gap-3">
      <h2 id="breakdown-title" className="text-micro text-grey-700 uppercase">
        {t("admin.activity.breakdown.title")}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        {groups.map(([key, title]) => (
          <div key={key} className="border-grey-200 border p-4">
            <h3 className="text-micro text-grey-700 uppercase">{t(title)}</h3>
            {data[key].length === 0 ? (
              <p className="text-small text-grey-700 mt-2">
                {t("admin.activity.breakdown.empty")}
              </p>
            ) : (
              <ol className="text-small mt-2 flex flex-col gap-1">
                {data[key].map((e) => (
                  <li key={e.value} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">
                      {label(key, e.value)}
                    </span>
                    <span className="tabular-nums">{number(e.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityRows({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  const sizeLabel = (variant: string) =>
    Object.hasOwn(SIZE_KEYS, variant) ? t(SIZE_KEYS[variant]!) : variant;
  const common = (x: Row) => (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.when")}>
        {dateTimeOrEmpty(x.createdAt)}
      </td>
      <td role="cell" className={td} data-label={t("admin.activity.col.who")}>
        <Who email={x.email} />
      </td>
    </>
  );
  const tail = (x: Row) => (
    <>
      <td role="cell" className={td} data-label={t("admin.activity.col.size")}>
        {sizeLabel(x.variant)}
      </td>
      <VisitorCells x={x} />
    </>
  );
  if (!r.bulk) {
    return (
      <tr role="row" className={rowCls}>
        {common(r)}
        <td
          role="cell"
          className={td}
          data-label={t("admin.activity.col.what")}
        >
          <PhotoCell r={r} />
        </td>
        {tail(r)}
      </tr>
    );
  }
  const { bulk } = r;
  return (
    <>
      <tr role="row" className={rowCls}>
        {common(r)}
        <td
          role="cell"
          className={td}
          data-label={t("admin.activity.col.what")}
        >
          <span className="flex flex-wrap items-center gap-3">
            <span>{bulkTitle(bulk.scope, bulk.count, t)}</span>
            {bulk.children.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="text-micro border-ink border px-2 py-0.5 uppercase"
              >
                {open ? t("admin.hidePhotos") : t("admin.showPhotos")}
              </button>
            ) : null}
          </span>
        </td>
        {tail(r)}
      </tr>
      {open
        ? bulk.children.map((c) => (
            <tr key={c.id} role="row" className={`${rowCls} bg-grey-100`}>
              <td
                role="cell"
                className={td}
                data-label={t("admin.activity.col.when")}
              >
                {dateTimeOrEmpty(c.createdAt)}
              </td>
              <td
                role="cell"
                aria-hidden="true"
                className={`${td} text-grey-700 hidden md:table-cell`}
              >
                ↳
              </td>
              <td
                role="cell"
                className={td}
                data-label={t("admin.activity.col.what")}
              >
                <PhotoCell r={c} />
              </td>
              {tail(c)}
            </tr>
          ))
        : null}
    </>
  );
}

export function ActivityView({ data }: { data: ActivityViewData }) {
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  const base = `/admin/g/${data.gallery.id}`;
  const f = data.filters;
  const moreQs = new URLSearchParams();
  if (f.visitor) moreQs.set("visitor", f.visitor);
  if (f.size) moreQs.set("size", f.size);
  if (data.next) moreQs.set("cursor", data.next);
  const s = data.summary;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to="/admin"
          className="text-micro text-grey-700 hover:text-ink flex min-h-tap items-center uppercase md:min-h-0"
        >
          {t("admin.backToGalleries")}
        </Link>
        <h1 className="text-title text-ink">{data.gallery.title}</h1>
      </div>
      <GalleryTabs id={data.gallery.id} current="actividad" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card label={t("admin.activity.visits")} value={s.views} />
        <Card
          label={t("admin.activity.visitorsWithEmail")}
          value={s.visitors}
        />
        <Card label={t("admin.activity.photosDownloaded")} value={s.photos} />
        <Card label={t("admin.activity.fullDownloads")} value={s.bulks} />
      </div>

      <Breakdown data={data.breakdown} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-micro text-grey-700 uppercase">
                {t("admin.activity.visitor")}
              </span>
              <select
                name="visitor"
                defaultValue={f.visitor}
                className={selectCls}
              >
                <option value="">{t("admin.activity.all")}</option>
                <option value="anon">{t("admin.activity.anonOnly")}</option>
                {data.visitorOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro text-grey-700 uppercase">
                {t("admin.activity.size")}
              </span>
              <select name="size" defaultValue={f.size} className={selectCls}>
                <option value="">{t("admin.activity.all")}</option>
                {Object.entries(SIZE_KEYS).map(([k, key]) => (
                  <option key={k} value={k}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="text-micro border-ink border px-4 py-2 uppercase"
            >
              {t("admin.activity.filter")}
            </button>
          </Form>
          <a
            href={`${base}/activity.csv`}
            data-tap
            className="text-micro border-ink border px-4 py-2 uppercase"
          >
            {t("admin.activity.exportCsv")}
          </a>
        </div>

        {data.rows.length === 0 ? (
          <p className="text-small text-grey-700">
            {t("admin.activity.noDownloads")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              role="table"
              aria-label={t("admin.activity.downloads")}
              className={tableCls}
            >
              <thead role="rowgroup" className={headCls}>
                <tr role="row">
                  <th scope="col" className={th}>
                    {t("admin.activity.col.when")}
                  </th>
                  <th scope="col" className={th}>
                    {t("admin.activity.col.who")}
                  </th>
                  <th scope="col" className={th}>
                    {t("admin.activity.col.what")}
                  </th>
                  <th scope="col" className={th}>
                    {t("admin.activity.col.size")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.place")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.device")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.source")}
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="block md:table-row-group">
                {data.rows.map((r) => (
                  <ActivityRows key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.next ? (
          <Link
            to={`${base}/activity?${moreQs.toString()}`}
            className="text-micro text-ink self-start underline uppercase"
          >
            {t("admin.activity.older")}
          </Link>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-micro text-grey-700 uppercase">
          {t("admin.activity.latestVisits")}
        </h2>
        {data.views.length === 0 ? (
          <p className="text-small text-grey-700">
            {t("admin.activity.noVisits")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              role="table"
              aria-label={t("admin.activity.visitsTable")}
              className={tableCls}
            >
              <thead role="rowgroup" className={headCls}>
                <tr role="row">
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.date")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.visitor")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.place")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.device")}
                  </th>
                  <th scope="col" role="columnheader" className={th}>
                    {t("admin.activity.col.source")}
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="block md:table-row-group">
                {data.views.map((v, i) => (
                  <tr key={i} role="row" className={rowCls}>
                    <td
                      role="cell"
                      className={td}
                      data-label={t("admin.activity.col.date")}
                    >
                      {dateTimeOrEmpty(v.createdAt)}
                    </td>
                    <td
                      role="cell"
                      className={td}
                      data-label={t("admin.activity.visitor")}
                    >
                      <Who email={v.email} />
                    </td>
                    <VisitorCells x={v} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
