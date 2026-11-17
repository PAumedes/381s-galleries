import { coverObjectPosition } from "../lib/cover-focus";
import { formatEventDate } from "../lib/event-date";
import type { HomeItem } from "../lib/server/home";
import { useLang, useT } from "../i18n/use-t";
import { useStudioName } from "../lib/use-studio-name";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { SiteFooter } from "./SiteFooter";
import { imgUrl } from "./types";

// Tiles are 4:3 at every width; only the ratio matters for the crop.
const FRAME = { w: 4, h: 3 };

/**
 * Public home: the studio mark and a grid of the galleries the owner chose to
 * show (`loadHome`). With none, the minimal logo-only home. Not themed per
 * gallery: always the Claro look.
 */
export function HomePage({ items }: { items: HomeItem[] }) {
  const studio = useStudioName();
  const t = useT();
  const lang = useLang();

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
        <ul
          aria-label={t("home.galleries")}
          className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((it) => {
            const date = formatEventDate(it.eventDate, lang);
            const pos = coverObjectPosition(
              it.cover.focus,
              it.cover.aspect,
              FRAME,
            );
            return (
              <li key={it.slug}>
                <a
                  href={`/${encodeURIComponent(it.slug)}`}
                  className="group focus-visible:outline-ink flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  <span className="bg-grey-100 block aspect-[4/3] w-full overflow-hidden">
                    <img
                      src={imgUrl(it.cover.id, "view-sm", it.cover.v)}
                      alt={it.title}
                      width={800}
                      height={600}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span
                      aria-hidden="true"
                      className="text-body group-hover:underline underline-offset-4"
                    >
                      {it.title}
                    </span>
                    {date && (
                      <span className="text-micro-label text-grey-600 uppercase">
                        {date}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
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
