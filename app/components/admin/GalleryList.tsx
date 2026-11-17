import { Link, useNavigate } from "react-router";

import {
  FILTERS,
  FILTER_LABELS,
  fmtDate,
  utcIsoToBaLocal,
} from "../../lib/admin-gallery";
import type { Filter } from "../../lib/admin-gallery";
import type { GalleryListRow } from "../../lib/server/admin-galleries";

export type GalleryListItem = GalleryListRow;

const STATUS_LABEL = {
  published: "Publicada",
  draft: "Borrador",
  archived: "Archivada",
} as const;

export function StatusPill({
  status,
  expired = false,
}: {
  status: keyof typeof STATUS_LABEL;
  expired?: boolean;
}) {
  const label =
    expired && status === "published" ? "Expirada" : STATUS_LABEL[status];
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

function fmtExpiry(iso: string | null): string {
  if (!iso) return "Sin vencimiento";
  const l = utcIsoToBaLocal(iso);
  return l ? `${fmtDate(l.date)} ${l.time}` : "—";
}

function EmptyLibrary() {
  return (
    <div className="border-grey-200 flex max-w-2xl flex-col gap-4 border p-6">
      <h2 className="text-micro text-grey-700 uppercase">
        Todavía no hay galerías
      </h2>
      <p className="text-body">
        Las galerías se crean solas: cada carpeta de la carpeta raíz de Drive es
        una galería. Exportá desde Capture One con todas las recetas y esperá la
        sincronización (cada 15 minutos) o usá “Sincronizar ahora” en{" "}
        <Link to="/admin/setup" className="underline">
          Ajustes
        </Link>
        .
      </p>
      <pre className="bg-grey-50 text-small overflow-x-auto p-4 leading-6">{`381studios/                  carpeta raíz
└─ nombre-del-album/         una carpeta = una galería
   ├─ high-res/              2048 px, obligatoria
   ├─ web/                   1200 px
   ├─ ig/                    1080 px (opcional)
   ├─ thumb/                 600 px
   └─ preview-wm/            con marca de agua (opcional)`}</pre>
      <p className="text-small text-grey-600">
        Dentro de cada receta podés crear subcarpetas con el mismo nombre para
        armar sets (por ejemplo, <code>high-res/Ceremonia</code> y{" "}
        <code>web/Ceremonia</code>). Los archivos se vinculan por set y nombre
        de archivo. Las galerías nuevas empiezan como borrador.
      </p>
    </div>
  );
}

export function GalleryList({
  galleries,
  filter,
  total,
}: {
  galleries: GalleryListItem[];
  filter: Filter;
  total: number;
}) {
  const navigate = useNavigate();
  if (total === 0 && galleries.length === 0) return <EmptyLibrary />;
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filtrar galerías" className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            to={f === "todas" ? "/admin" : `/admin?estado=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`text-micro px-3 py-2 uppercase ${f === filter ? "bg-ink text-paper" : "text-grey-700 hover:text-ink"}`}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>
      {galleries.length === 0 ? (
        <p className="text-body text-grey-600">
          No hay galerías en este filtro.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-small w-full min-w-[56rem] text-left">
            <thead className="text-micro text-grey-600 uppercase">
              <tr className="border-grey-200 border-b">
                <th scope="col" className="w-20 py-2 pr-3 font-medium">
                  <span className="sr-only">Portada</span>
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Título
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Fecha
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Fotos
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Vistas
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Descargas
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Vence
                </th>
                <th scope="col" className="py-2 font-medium">
                  Avisos
                </th>
              </tr>
            </thead>
            <tbody>
              {galleries.map((g) => (
                <tr
                  key={g.id}
                  onClick={(ev) => {
                    if (!(ev.target as HTMLElement).closest("a"))
                      void navigate(`/admin/g/${g.id}`);
                  }}
                  className="border-grey-100 hover:bg-grey-50 cursor-pointer border-b"
                >
                  <td className="py-2 pr-3">
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
                  <td className="py-2 pr-3">
                    <Link
                      to={`/admin/g/${g.id}`}
                      className="text-body text-ink font-medium underline-offset-4 hover:underline"
                    >
                      {g.title}
                    </Link>
                    <div className="text-grey-500">/{g.slug}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {g.eventDate ? fmtDate(g.eventDate) : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusPill status={g.status} expired={g.expired} />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {g.photoCount}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {g.views}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {g.downloads}
                  </td>
                  <td className="py-2 pr-3">{fmtExpiry(g.expiresAt)}</td>
                  <td className="py-2">
                    {g.issueCount > 0 && (
                      <span
                        aria-label={`${g.issueCount} ${g.issueCount === 1 ? "aviso" : "avisos"} de sincronización`}
                        className="text-micro border-ink inline-block border px-2 py-0.5"
                      >
                        {g.issueCount}
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
