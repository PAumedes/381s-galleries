import { useState } from "react";
import { Form, Link } from "react-router";

import { SIZE_LABELS, bulkTitle, fmtBa } from "../../lib/admin-activity";
import type { loadActivity } from "../../lib/server/admin-activity";
import { GalleryTabs } from "./GalleryTabs";

export type ActivityViewData = NonNullable<
  Awaited<ReturnType<typeof loadActivity>>
>;
type Row = ActivityViewData["rows"][number];

const th = "text-micro text-grey-700 px-3 py-2 text-left font-medium uppercase";
const td = "px-3 py-2 align-middle text-small";
const selectCls = "border-grey-300 bg-white border px-3 py-2 text-small";

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-grey-200 flex flex-col gap-1 border p-4">
      <p className="text-micro text-grey-700 uppercase">{label}</p>
      <p className="text-title text-ink">{value}</p>
    </div>
  );
}

function Who({ email }: { email: string | null }) {
  return email ? <>{email}</> : <span className="text-grey-700">Anónimo</span>;
}

function PhotoCell({ r }: { r: Row }) {
  if (!r.photoId) return <span className="text-grey-700">—</span>;
  return (
    <span className="flex items-center gap-3">
      <img
        src={`/admin/img/${r.photoId}/thumb`}
        alt={r.name ?? ""}
        loading="lazy"
        className="bg-grey-200 h-10 w-10 object-cover"
      />
      <span>{r.name ?? "(foto eliminada)"}</span>
    </span>
  );
}

function ActivityRows({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const common = (x: Row) => (
    <>
      <td className={td}>{fmtBa(x.createdAt)}</td>
      <td className={td}>
        <Who email={x.email} />
      </td>
    </>
  );
  const tail = (x: Row) => (
    <>
      <td className={td}>{SIZE_LABELS[x.variant] ?? x.variant}</td>
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
            <span>{bulkTitle(bulk.scope, bulk.count)}</span>
            {bulk.children.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="text-micro border-ink border px-2 py-0.5 uppercase"
              >
                {open ? "Ocultar fotos" : "Ver fotos"}
              </button>
            ) : null}
          </span>
        </td>
        {tail(r)}
      </tr>
      {open
        ? bulk.children.map((c) => (
            <tr key={c.id} className="bg-grey-100 border-grey-200 border-t">
              <td className={td}>{fmtBa(c.createdAt)}</td>
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
          className="text-micro text-grey-700 uppercase hover:text-ink"
        >
          ← Galerías
        </Link>
        <h1 className="text-title text-ink">{data.gallery.title}</h1>
      </div>
      <GalleryTabs id={data.gallery.id} current="actividad" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card label="Visitas" value={s.views} />
        <Card label="Visitantes con email" value={s.visitors} />
        <Card label="Fotos descargadas" value={s.photos} />
        <Card label="Descargas completas" value={s.bulks} />
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-micro text-grey-700 uppercase">
                Visitante
              </span>
              <select
                name="visitor"
                defaultValue={f.visitor}
                className={selectCls}
              >
                <option value="">Todos</option>
                <option value="anon">Anónimos</option>
                {data.visitorOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro text-grey-700 uppercase">Tamaño</span>
              <select name="size" defaultValue={f.size} className={selectCls}>
                <option value="">Todos</option>
                {Object.entries(SIZE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="text-micro border-ink border px-4 py-2 uppercase"
            >
              Filtrar
            </button>
          </Form>
          <a
            href={`${base}/activity.csv`}
            className="text-micro border-ink border px-4 py-2 uppercase"
          >
            Exportar CSV
          </a>
        </div>

        {data.rows.length === 0 ? (
          <p className="text-small text-grey-700">Sin descargas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Descargas" className="w-full min-w-[40rem]">
              <thead>
                <tr>
                  <th className={th}>Cuándo</th>
                  <th className={th}>Quién</th>
                  <th className={th}>Qué</th>
                  <th className={th}>Tamaño</th>
                  <th className={th}>País</th>
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
            Más antiguas →
          </Link>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-micro text-grey-700 uppercase">Últimas visitas</h2>
        {data.views.length === 0 ? (
          <p className="text-small text-grey-700">Sin visitas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Visitas" className="w-full max-w-xl">
              <thead>
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Visitante</th>
                  <th className={th}>País</th>
                </tr>
              </thead>
              <tbody>
                {data.views.map((v, i) => (
                  <tr key={i} className="border-grey-200 border-t">
                    <td className={td}>{fmtBa(v.createdAt)}</td>
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
