import { useT } from "../../i18n/use-t";
import { useStudioName } from "../../lib/use-studio-name";
import { LanguageToggle } from "../LanguageToggle";
import { SiteFooter } from "../SiteFooter";

export function PageFooter() {
  const t = useT();
  const studio = useStudioName();
  return (
    <footer className="flex flex-col items-center gap-4 px-6 py-section">
      <p className="text-micro-label text-grey-600 uppercase">
        {t("footer.copyright", { year: new Date().getFullYear(), studio })}
      </p>
      <SiteFooter />
      <LanguageToggle className="text-grey-600" />
    </footer>
  );
}
