import { logoSource, Wordmark } from "../Logo";
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
  /** Uploaded-logo versions from the root loader (null = bundled). */
  logo?: { onLight: string | null; onDark: string | null };
}

const TEXT = {
  es: { print: "Imprimir", other: "EN", otherLang: "en" },
  en: { print: "Print", other: "ES", otherLang: "es" },
} as const;

type CardText = (typeof TEXT)[CardLang];

/** Screen-only buttons: print and switch the card's language. */
function CardToolbar({ t }: { t: CardText }) {
  return (
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
  );
}

/** A6 portrait (105x148 mm) card; print CSS in app.css (.print-card). */
export function CardView(card: CardData) {
  const { title, url, hasPin, studioName, lang } = card;
  const date = formatEventDate(card.eventDate, lang);
  const cardLogo = logoSource("dark", card.logo);
  return (
    <div
      data-admin
      className="card-screen bg-grey-100 flex min-h-screen flex-col items-center gap-6 p-6 print:block print:min-h-0 print:bg-white print:p-0"
    >
      <CardToolbar t={TEXT[lang]} />
      <article
        lang={lang}
        className="print-card flex flex-col items-center justify-between bg-white text-black"
      >
        {cardLogo ? (
          <img src={cardLogo.src} alt="" className="h-[9mm] w-auto" />
        ) : (
          <Wordmark
            name={studioName}
            className="h-[9mm] leading-[9mm]"
            fontSize="4mm"
          />
        )}
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
