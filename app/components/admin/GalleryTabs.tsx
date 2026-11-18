import { useEffect, useRef } from "react";
import { Link } from "react-router";

import { useT } from "../../i18n/use-t";

/** Editor panels: one page (`/admin/g/:id`), picked with `?tab=`. */
export const EDITOR_TABS = [
  "datos",
  "fotos",
  "portada",
  "diseno",
  "compartir",
] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];

export const isEditorTab = (v: unknown): v is EditorTab =>
  EDITOR_TABS.includes(v as EditorTab);

const TABS = [
  { key: "datos", label: "admin.tabs.details", path: "" },
  { key: "fotos", label: "admin.tabs.photos", path: "?tab=fotos" },
  { key: "portada", label: "admin.tabs.cover", path: "?tab=portada" },
  { key: "diseno", label: "admin.tabs.design", path: "?tab=diseno" },
  { key: "compartir", label: "admin.tabs.share", path: "?tab=compartir" },
  { key: "actividad", label: "admin.tabs.activity", path: "/activity" },
  { key: "favoritos", label: "admin.tabs.favorites", path: "/favorites" },
] as const;

export type GalleryTab = (typeof TABS)[number]["key"];

/**
 * The one navigation of a gallery: the editor panels (Datos, Fotos, Portada,
 * Diseño, Compartir) and the Actividad / Favoritos pages. Shareable URLs;
 * scrolls sideways on phones instead of wrapping.
 */
export function GalleryTabs({
  id,
  current,
  unsaved = [],
}: {
  id: string;
  current: GalleryTab;
  /** Panels with unsaved changes (a dot after the label). */
  unsaved?: readonly GalleryTab[];
}) {
  const t = useT();
  const navRef = useRef<HTMLElement>(null);
  // Phones: keep the current tab in view in the sideways-scrolling bar.
  useEffect(() => {
    const nav = navRef.current;
    const cur = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !cur || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
  }, [current]);
  return (
    <nav
      ref={navRef}
      aria-label={t("admin.tabs.label")}
      data-scroll-x=""
      className="border-grey-200 -mx-4 overflow-x-auto border-b px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex min-w-max gap-1 md:gap-6">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            to={`/admin/g/${id}${tab.path}`}
            aria-current={tab.key === current ? "page" : undefined}
            className={`text-micro -mb-px flex min-h-tap items-center gap-1.5 border-b-2 px-2 uppercase md:px-0 md:py-3 ${
              tab.key === current
                ? "border-ink text-ink"
                : "text-grey-700 hover:text-ink border-transparent"
            }`}
          >
            {t(tab.label)}
            {unsaved.includes(tab.key) && (
              <>
                <span
                  data-unsaved=""
                  aria-hidden="true"
                  className="bg-ink inline-block size-1.5 rounded-full"
                />
                <span className="sr-only">{t("admin.tabs.unsaved")}</span>
              </>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
