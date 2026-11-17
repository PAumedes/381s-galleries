import { Link } from "react-router";

const TABS = [
  { key: "datos", label: "Datos", path: "" },
  { key: "actividad", label: "Actividad", path: "/activity" },
  { key: "favoritos", label: "Favoritos", path: "/favorites" },
] as const;

export type GalleryTab = (typeof TABS)[number]["key"];

/** Sub-navigation of one gallery (edit / activity / favorites): shareable URLs. */
export function GalleryTabs({
  id,
  current,
}: {
  id: string;
  current: GalleryTab;
}) {
  return (
    <nav aria-label="Secciones de la galería" className="flex gap-6">
      {TABS.map((t) => (
        <Link
          key={t.key}
          to={`/admin/g/${id}${t.path}`}
          aria-current={t.key === current ? "page" : undefined}
          className={`text-micro border-b pb-1 uppercase ${
            t.key === current
              ? "border-ink text-ink"
              : "text-grey-700 hover:text-ink border-transparent"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
