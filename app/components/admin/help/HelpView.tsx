import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { useT } from "../../../i18n/use-t";
import { HELP_SECTIONS, helpSectionKey } from "../../../lib/help";
import { WIZARD_PATH } from "../../../lib/wizard";
import { helpMatches, resolveHelpItem } from "../../../lib/help-text";
import { HelpItemView } from "./HelpItemView";
import { useHelpAnchor } from "./use-help-anchor";
import { useHelpPrint } from "./use-help-print";
import { useHelpSearchOpen } from "./use-help-search-open";

/** The result count is announced once typing settles, not on every key. */
const ANNOUNCE_DELAY_MS = 500;

function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

const FIELD =
  "border-grey-400 bg-white text-ink min-h-12 w-full border px-3 text-base focus-visible:outline-ink focus-visible:outline-2 focus-visible:outline-offset-2 md:min-h-11";
const CHIP =
  "border-ink text-ink hover:bg-ink hover:text-paper focus-visible:outline-ink inline-flex min-h-11 items-center border px-4 text-base focus-visible:outline-2 focus-visible:outline-offset-2";

/** The help for the studio owner: short questions in a few sections, with a search box. */
export function HelpView() {
  const t = useT();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  useHelpAnchor();
  useHelpPrint();

  const shown = useMemo(
    () =>
      HELP_SECTIONS.map((s) => ({
        id: s.id,
        items: s.items.filter((i) => helpMatches(resolveHelpItem(i, t), query)),
      })).filter((s) => s.items.length > 0),
    [t, query],
  );
  const searching = query.trim() !== "";
  const total = shown.reduce((n, s) => n + s.items.length, 0);
  const shownIds = useMemo(
    () => shown.flatMap((s) => s.items.map((i) => i.id)),
    [shown],
  );
  useHelpSearchOpen(shownIds, searching);
  const announce = useSettled(
    searching
      ? total > 0
        ? t("admin.help.search.count", { count: total })
        : t("admin.help.search.none")
      : "",
    ANNOUNCE_DELAY_MS,
  );

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-title text-ink">{t("admin.help.title")}</h1>
        <p className="text-ink text-base leading-relaxed">
          {t("admin.help.intro")}
        </p>
        <a
          href={WIZARD_PATH}
          className="text-ink focus-visible:outline-ink inline-flex min-h-12 items-center text-base underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t("admin.wizard.helpLink")}
        </a>
        <form
          role="search"
          method="get"
          action="/admin/ayuda"
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("admin.help.search.label")}
            placeholder={t("admin.help.search.placeholder")}
            autoComplete="off"
            className={FIELD}
          />
          <button
            type="submit"
            className="border-ink bg-ink text-paper focus-visible:outline-ink min-h-12 border px-6 text-base focus-visible:outline-2 focus-visible:outline-offset-2 md:min-h-11"
          >
            {t("admin.help.search.submit")}
          </button>
        </form>
        <p role="status" aria-live="polite" className="text-ink text-base">
          {announce}
        </p>
        <nav aria-label={t("admin.help.toc")}>
          <ul className="flex flex-wrap gap-2">
            {shown.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={CHIP}>
                  {t(helpSectionKey(s.id))}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {shown.map((s) => (
        <section
          key={s.id}
          id={s.id}
          aria-labelledby={`${s.id}-title`}
          className="scroll-mt-4"
        >
          <h2
            id={`${s.id}-title`}
            className="text-ink border-ink border-b-2 pb-2 text-xl font-semibold"
          >
            {t(helpSectionKey(s.id))}
          </h2>
          {s.items.map((item) => (
            <HelpItemView key={item.id} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}
