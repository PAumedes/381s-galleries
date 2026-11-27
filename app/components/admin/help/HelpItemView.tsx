import type { HelpItem } from "../../../lib/help";
import { rawHelpItem } from "../../../lib/help-text";
import { useT } from "../../../i18n/use-t";
import { HelpText } from "./HelpText";

const BODY = "text-ink text-base leading-relaxed";

/** One question: a native details (works without scripts, opens with Enter and Space). */
export function HelpItemView({
  item,
  open,
}: {
  item: HelpItem;
  /** Forced open (search results); undefined leaves it to the reader. */
  open?: true;
}) {
  const t = useT();
  const raw = rawHelpItem(item, t);
  const List = item.bullets ? "ul" : "ol";
  return (
    <details
      id={item.id}
      open={open}
      className="group border-grey-200 scroll-mt-4 border-b"
    >
      <summary className="text-ink focus-visible:outline-ink flex min-h-[3.25rem] cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg leading-snug font-medium focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <span>
          <HelpText raw={raw.q} item={item} />
        </span>
        <span
          aria-hidden="true"
          className="text-grey-700 shrink-0 text-2xl leading-none transition-transform group-open:rotate-45 motion-reduce:transition-none"
        >
          +
        </span>
      </summary>
      <div className={`${BODY} flex max-w-prose flex-col gap-3 pr-8 pb-5`}>
        {raw.a !== undefined && (
          <p>
            <HelpText raw={raw.a} item={item} />
          </p>
        )}
        {raw.steps.length > 0 && (
          <List
            className={`flex flex-col gap-2 pl-6 ${item.bullets ? "list-disc" : "list-decimal"}`}
          >
            {raw.steps.map((s, i) => (
              <li key={i} className="pl-1">
                <HelpText raw={s} item={item} />
              </li>
            ))}
          </List>
        )}
      </div>
    </details>
  );
}
