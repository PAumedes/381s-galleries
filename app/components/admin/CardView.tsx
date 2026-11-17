import { formatEventDate } from "../../lib/event-date";
import { QrCode } from "./QrCode";

export type CardLang = "es" | "en";

export interface CardData {
  title: string;
  eventDate: string | null;
  url: string;
  hasPin: boolean;
  studioName: string;
  lang: CardLang;
}

const TEXT = {
  es: { print: "Imprimir", other: "EN", otherLang: "en" },
  en: { print: "Print", other: "ES", otherLang: "es" },
} as const;

/** A6 portrait (105x148 mm) card; print CSS in app.css (.print-card). */
export function CardView({
  title,
  eventDate,
  url,
  hasPin,
  studioName,
  lang,
}: CardData) {
  const t = TEXT[lang];
  const date = formatEventDate(eventDate, lang);
  return (
    <div
      data-admin
      className="card-screen bg-grey-100 flex min-h-screen flex-col items-center gap-6 p-6 print:block print:min-h-0 print:bg-white print:p-0"
    >
      <div className="flex items-center gap-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="text-micro uppercase border border-ink bg-ink min-h-tap px-4 py-2 text-paper md:min-h-0"
        >
          {t.print}
        </button>
        <a
          href={`?lang=${t.otherLang}`}
          lang={t.otherLang}
          data-tap
          className="text-micro uppercase border border-ink px-4 py-2"
        >
          {t.other}
        </a>
      </div>
      <article
        lang={lang}
        className="print-card flex flex-col items-center justify-between bg-white text-black"
      >
        <img src="/brand/logo-black.svg" alt="" className="h-[9mm] w-auto" />
        <div className="flex min-w-0 max-w-full flex-col items-center gap-[2mm] text-center">
          <h1 className="line-clamp-3 min-w-0 max-w-full break-words text-[4.2mm] font-light uppercase tracking-[0.2em]">
            {title}
          </h1>
          {date && <p className="text-[2.6mm] tracking-[0.1em]">{date}</p>}
        </div>
        <QrCode url={url} className="size-[55mm] [&>svg]:size-full" />
        <div className="flex flex-col items-center gap-[2mm] text-center">
          <p className="text-[2.2mm] break-all tracking-wide">{url}</p>
          {hasPin && (
            <p className="text-[3mm] tracking-wider">PIN: ____________</p>
          )}
        </div>
        <p className="min-w-0 max-w-full break-words text-center text-[2.2mm] uppercase tracking-[0.2em]">
          {studioName}
        </p>
      </article>
    </div>
  );
}
