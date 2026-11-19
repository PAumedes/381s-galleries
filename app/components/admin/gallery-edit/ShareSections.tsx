import { useT } from "../../../i18n/use-t";
import { External } from "../../icons";
import { SharePanel } from "../SharePanel";
import type { EditGallery } from "./types";
import { btn, Section } from "./ui";

/** Compartir tab: public link and QR, and the real client view. */
export function ShareSections({
  g,
  origin,
}: {
  g: EditGallery;
  origin?: string;
}) {
  const t = useT();
  return (
    <>
      <Section title={t("admin.edit.section.share")}>
        <SharePanel
          url={`${origin ?? window.location.origin}/${g.slug}`}
          slug={g.slug}
          title={g.title}
          status={g.status}
          hasPin={g.hasPin}
          cardHref={`/admin/g/${g.id}/card`}
        />
      </Section>

      <Section title={t("admin.edit.section.clientView")}>
        <p className="text-small text-grey-700">
          {t("admin.edit.clientViewNote")}
        </p>
        <div>
          <a
            href={`/admin/g/${encodeURIComponent(g.id)}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btn} inline-flex items-center gap-2`}
          >
            <External aria-hidden="true" className="size-4" />
            {t("admin.edit.openPreview")}
          </a>
        </div>
      </Section>
    </>
  );
}
