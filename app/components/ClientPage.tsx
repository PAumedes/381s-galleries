import type { ClientPageData } from "../lib/server/client-page";
import { useT } from "../i18n/use-t";
import { useStudioName } from "../lib/use-studio-name";
import { AlbumGrid } from "./AlbumGrid";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { SiteFooter } from "./SiteFooter";

/** Client homepage `/:client` (T6.40e): the client's name and its album tiles. */
export function ClientPage({ page }: { page: ClientPageData }) {
  const studio = useStudioName();
  const t = useT();
  return (
    <div className="bg-paper text-ink min-h-dvh">
      <header className="flex flex-col items-center gap-6 px-6 pt-10 pb-10 text-center sm:pt-14">
        <Logo variant="dark" name={studio} className="h-12 sm:h-16" />
        <h1 className="text-title max-w-full text-balance [overflow-wrap:anywhere]">
          {page.clientName}
        </h1>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <AlbumGrid items={page.items} label={t("client.albums")} />
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
