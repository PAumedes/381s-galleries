import { Link } from "react-router";

import { useT } from "../../i18n/use-t";

const TABS = [
  { key: "datos", label: "admin.tabs.details", path: "" },
  { key: "actividad", label: "admin.tabs.activity", path: "/activity" },
  { key: "favoritos", label: "admin.tabs.favorites", path: "/favorites" },
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
  const t = useT();
  return (
    <nav aria-label={t("admin.tabs.label")} className="flex gap-2 md:gap-6">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          to={`/admin/g/${id}${tab.path}`}
          aria-current={tab.key === current ? "page" : undefined}
          className={`text-micro flex min-h-tap items-center border-b px-2 uppercase md:min-h-0 md:px-0 md:pb-1 ${
            tab.key === current
              ? "border-ink text-ink"
              : "text-grey-700 hover:text-ink border-transparent"
          }`}
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
