import { useState } from "react";
import { Form, Link } from "react-router";

import { useFormat } from "../../i18n/use-format";
import { useT } from "../../i18n/use-t";
import { SIZE_KEYS, bulkTitle } from "../../lib/admin-activity";
import type { loadActivity } from "../../lib/server/admin-activity";
import { GalleryTabs } from "./GalleryTabs";

export type ActivityViewData = NonNullable<
  Awaited<ReturnType<typeof loadActivity>>
>;
type Row = ActivityViewData["rows"][number];

const th = "text-micro text-grey-700 px-3 py-2 text-left font-medium uppercase";
const td = "px-3 py-2 align-middle text-small";
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

function ActivityRows({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { dateTimeOrEmpty } = useFormat();
  const sizeLabel = (variant: string) =>
    Object.hasOwn(SIZE_KEYS, variant) ? t(SIZE_KEYS[variant]!) : variant;
  const common = (x: Row) => (
    <>
      <td className={td}>{dateTimeOrEmpty(x.createdAt)}</td>
      <td className={td}>
        <Who email={x.email} />
      </td>
    </>
  );
  const tail = (x: Row) => (
    <>
      <td className={td}>{sizeLabel(x.variant)}</td>
      <td className={td}>{x.country ?? "—"}</td>
    </>
  );
  if (!r.bulk) {
    return (
      <tr className="border-grey-200 border-t">
        {common(r)}
        <td className={td}>
          <PhotoCell r={r} />
        </td>
        {tail(r)}
      </tr>
    );
  }
  const { bulk } = r;
  return (
    <>
      <tr className="border-grey-200 border-t">
        {common(r)}
        <td className={td}>
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
            <tr key={c.id} className="bg-grey-100 border-grey-200 border-t">
              <td className={td}>{dateTimeOrEmpty(c.createdAt)}</td>
              <td className={`${td} text-grey-700`}>↳</td>
              <td className={td}>
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
              aria-label={t("admin.activity.downloads")}
              className="w-full min-w-[40rem]"
            >
              <thead>
                <tr>
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
                  <th scope="col" className={th}>
                    {t("admin.activity.col.country")}
                  </th>
                </tr>
              </thead>
              <tbody>
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
              aria-label={t("admin.activity.visitsTable")}
              className="w-full max-w-xl"
            >
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    {t("admin.activity.col.date")}
                  </th>
                  <th scope="col" className={th}>
                    {t("admin.activity.visitor")}
                  </th>
                  <th scope="col" className={th}>
                    {t("admin.activity.col.country")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.views.map((v, i) => (
                  <tr key={i} className="border-grey-200 border-t">
                    <td className={td}>{dateTimeOrEmpty(v.createdAt)}</td>
                    <td className={td}>
                      <Who email={v.email} />
                    </td>
                    <td className={td}>{v.country ?? "—"}</td>
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
