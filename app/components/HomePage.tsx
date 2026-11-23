import type { HomeItem } from "../lib/server/home";
import { useT } from "../i18n/use-t";
import { useStudioName } from "../lib/use-studio-name";
import { AlbumGrid } from "./AlbumGrid";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { SiteFooter } from "./SiteFooter";

/**
 * Public home: the studio mark and a grid of the galleries the owner chose to
 * show (`loadHome`). With none, the minimal logo-only home. Not themed per
 * gallery: always the Claro look.
 */
export function HomePage({ items }: { items: HomeItem[] }) {
  const studio = useStudioName();
  const t = useT();

  if (items.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6">
        <h1>
          <Logo variant="dark" name={studio} className="h-24" />
        </h1>
        <SiteFooter />
      </main>
    );
  }

  return (
    <div className="bg-paper text-ink min-h-dvh">
      <header className="flex justify-center px-6 pt-12 pb-10 sm:pt-16">
        <h1>
          <Logo variant="dark" name={studio} className="h-20 sm:h-24" />
        </h1>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <AlbumGrid items={items} label={t("home.galleries")} />
      </main>
      <footer className="flex flex-col items-center gap-4 px-6 py-16">
        <p className="text-micro-label text-grey-600 uppercase">
          {t("footer.copyright", { year: new Date().getFullYear(), studio })}
        </p>
        <SiteFooter />
        <LanguageToggle className="text-grey-600" />
      </footer>
    </div>
  );
}
