import { useT } from "../../../i18n/use-t";
import { HELP_SECTIONS } from "../../../lib/help";
import { resolveHelpItem } from "../../../lib/help-text";

/**
 * A small "?" that opens the help at the answer for `topic` (an item id of
 * lib/help.ts). It opens in a new tab so an unsaved form is never lost. Its
 * name says which answer it opens ("Ayuda: <question>"), so a list of links
 * is not eighteen times "Ayuda". The link box is a 48px tap target on phones;
 * the visible circle stays small and the negative margin keeps the heading
 * row as tall as before.
 */
export function HelpLink({ topic }: { topic: string }) {
  const t = useT();
  const item = HELP_SECTIONS.flatMap((s) => s.items).find(
    (i) => i.id === topic,
  );
  const label = item
    ? t("admin.help.linkTo", { title: resolveHelpItem(item, t).q })
    : t("admin.nav.help");
  return (
    <a
      href={`/admin/ayuda#${topic}`}
      target="_blank"
      rel="noopener"
      aria-label={label}
      title={label}
      data-compact
      className="group focus-visible:outline-ink -my-3 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 md:my-0 md:min-h-8 md:min-w-8"
    >
      <span
        aria-hidden="true"
        className="border-grey-500 text-grey-800 text-small group-hover:border-ink group-hover:text-ink inline-flex size-6 items-center justify-center rounded-full border"
      >
        ?
      </span>
    </a>
  );
}
