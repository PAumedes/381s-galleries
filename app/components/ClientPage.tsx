import type { ClientPageData } from "../lib/server/client-page";
import { PAGE_PARAM } from "../lib/page-param";
import { useT } from "../i18n/use-t";
import { useStudioName } from "../lib/use-studio-name";
import { AlbumGrid } from "./AlbumGrid";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { SiteFooter } from "./SiteFooter";

const PAGER_LINK =
  "text-micro-label inline-flex min-h-12 min-w-12 items-center justify-center border border-grey-200 px-4 uppercase hover:bg-grey-50 focus-visible:outline-2 focus-visible:outline-ink";

/** Where page `n` of a client lives: page 1 is the bare URL (T6.49). */
function pagePath(clientSlug: string, n: number): string {
  const base = `/${encodeURIComponent(clientSlug)}`;
  return n > 1 ? `${base}?${PAGE_PARAM}=${n}` : base;
}

/** Previous / Next links: plain HTML, no JS needed; nothing but the page number is carried. */
function Pager({ page }: { page: ClientPageData }) {
  const t = useT();
  if (page.pageCount < 2) return null;
  return (
    <nav
      aria-label={t("client.pager")}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-12"
    >
      <p className="text-micro-label text-grey-600 w-full text-center uppercase">
        {t("client.pageOf", { page: page.page, count: page.pageCount })}
      </p>
      {page.page > 1 && (
        <a
          href={pagePath(page.clientSlug, page.page - 1)}
          className={PAGER_LINK}
        >
          {t("client.prev")}
        </a>
      )}
      {page.page < page.pageCount && (
        <a
          href={pagePath(page.clientSlug, page.page + 1)}
          className={`${PAGER_LINK} ms-auto`}
        >
          {t("client.next")}
        </a>
      )}
    </nav>
  );
}

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
        <Pager page={page} />
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
