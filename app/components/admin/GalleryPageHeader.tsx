import { Link } from "react-router";

import { useT } from "../../i18n/use-t";

/** "Back to galleries" link and the gallery title heading above an editor tab bar. */
export function GalleryPageHeader({ title }: { title: string }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Link
        to="/admin"
        className="text-micro text-grey-700 hover:text-ink flex min-h-tap items-center uppercase md:min-h-0"
      >
        {t("admin.backToGalleries")}
      </Link>
      <h1 className="text-title text-ink">{title}</h1>
    </div>
  );
}
