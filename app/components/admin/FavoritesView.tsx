import { useId, useState } from "react";
import { Link } from "react-router";

import { captureOneResult, fmtBa } from "../../lib/admin-activity";
import type { loadFavoritesAdmin } from "../../lib/server/admin-activity";
import { GalleryTabs } from "./GalleryTabs";

export type FavoritesViewData = NonNullable<
  Awaited<ReturnType<typeof loadFavoritesAdmin>>
>;
type Photo =
  | FavoritesViewData["all"][number]
  | FavoritesViewData["visitors"][number]["lists"][number]["photos"][number];

const btn = "text-micro border-ink border px-3 py-1.5 uppercase";

function Thumbs({
  photos,
  picks,
}: {
  photos: (Photo & { picks?: number })[];
  picks?: boolean;
}) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
      {photos.map((p) => (
        <li
          key={p.id}
          className={`flex flex-col gap-1 ${p.hidden ? "opacity-40" : ""}`}
        >
          {p.hidden ? (
            <div className="bg-grey-200 aspect-square w-full" />
          ) : (
            <img
              src={`/admin/img/${p.id}/thumb`}
              alt={p.name}
              loading="lazy"
              className="bg-grey-200 aspect-square w-full object-cover"
            />
          )}
          <span className="text-small break-all">
            {p.name}
            {p.hidden ? " (oculta)" : ""}
          </span>
          {picks && p.picks !== undefined ? (
            <span className="text-micro text-grey-700">
              {p.picks} {p.picks === 1 ? "visitante" : "visitantes"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Actions({
  photos,
  comma,
  href,
}: {
  photos: Photo[];
  comma: boolean;
  href: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  const [skipped, setSkipped] = useState<string[]>([]);
  const names = photos.filter((p) => !p.hidden).map((p) => p.name);
  async function copy() {
    try {
      const r = captureOneResult(names, comma ? "comma" : "space");
      setSkipped(r.skipped);
      await navigator.clipboard.writeText(r.text);
      setState("ok");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={btn} onClick={copy}>
        Copiar para Capture One
      </button>
      <a href={href} className={btn}>
        Descargar .txt
      </a>
      <span role="status" className="text-small text-grey-700">
        {state === "ok"
          ? "Copiado"
          : state === "error"
            ? "No se pudo copiar"
            : ""}
      </span>
      {skipped.length > 0 ? (
        <p role="status" className="text-small text-grey-700 w-full break-all">
          {skipped.length} nombres no se pudieron incluir: {skipped.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function VisitorSection({
  v,
  base,
  comma,
}: {
  v: FavoritesViewData["visitors"][number];
  base: string;
  comma: boolean;
}) {
  const [open, setOpen] = useState(false);
  const photos = v.lists.flatMap((l) => l.photos);
  const seen = new Set<string>();
  const unique = photos.filter((p) => !seen.has(p.id) && seen.add(p.id));
  return (
    <section className="border-grey-200 flex flex-col gap-3 border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body text-ink">{v.label}</h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={btn}
        >
          {open ? "Ocultar fotos" : "Ver fotos"}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {v.lists.map((l) => (
          <li key={l.name} className="text-small flex flex-wrap gap-x-4">
            <span>{l.name}</span>
            <span>
              {l.count} {l.count === 1 ? "foto" : "fotos"}
            </span>
            <span className="text-grey-700">{fmtBa(l.last)}</span>
          </li>
        ))}
      </ul>
      <Actions
        photos={unique}
        comma={comma}
        href={`${base}/favorites.txt?visitor=${encodeURIComponent(v.id)}`}
      />
      {open
        ? v.lists.map((l) => (
            <div key={l.name} className="flex flex-col gap-2">
              {v.lists.length > 1 ? (
                <h4 className="text-micro text-grey-700 uppercase">{l.name}</h4>
              ) : null}
              <Thumbs photos={l.photos} />
            </div>
          ))
        : null}
    </section>
  );
}

export function FavoritesView({ data }: { data: FavoritesViewData }) {
  const base = `/admin/g/${data.gallery.id}`;
  const [comma, setComma] = useState(false);
  const allId = useId();
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
      <GalleryTabs id={data.gallery.id} current="favoritos" />

      {data.visitors.length === 0 ? (
        <p className="text-small text-grey-700">
          Nadie marcó favoritos todavía.
        </p>
      ) : (
        <>
          <label className="text-small flex items-center gap-2">
            <input
              type="checkbox"
              checked={comma}
              onChange={(e) => setComma(e.target.checked)}
            />
            Separar con comas
          </label>
          <p className="text-small text-grey-700">
            Capture One: pegá el texto en el filtro de búsqueda del navegador
            (por defecto separado con espacios).
          </p>

          <section
            aria-labelledby={allId}
            className="border-ink flex flex-col gap-3 border p-4"
          >
            <h2 id={allId} className="text-micro text-ink uppercase">
              Todos los favoritos
            </h2>
            <p className="text-small text-grey-700">
              {data.all.length} {data.all.length === 1 ? "foto" : "fotos"} en
              total
            </p>
            <Actions
              photos={data.all}
              comma={comma}
              href={`${base}/favorites.txt`}
            />
            <Thumbs photos={data.all} picks />
          </section>

          <div className="flex flex-col gap-4">
            {data.visitors.map((v) => (
              <VisitorSection key={v.id} v={v} base={base} comma={comma} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
