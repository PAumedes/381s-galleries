import { placeholderText, tokenizeHelp } from "../../../lib/help-text";
import type { HelpItem } from "../../../lib/help";
import { useT } from "../../../i18n/use-t";

/**
 * One help text on screen: button names (placeholders) in bold between « »,
 * folder names (`code`) in a code style, everything else as plain words.
 */
export function HelpText({
  raw,
  item,
}: {
  raw: string;
  item: Pick<HelpItem, "labels" | "values">;
}) {
  const t = useT();
  return (
    <>
      {tokenizeHelp(raw).map((tok, i) => {
        if (tok.kind === "text") return tok.text;
        if (tok.kind === "code")
          return (
            <code
              key={i}
              className="bg-grey-100 text-ink px-1.5 py-0.5 font-mono text-[0.9em] break-words"
            >
              {tok.text}
            </code>
          );
        return (
          <strong key={i} className="font-semibold">
            {placeholderText(item, tok.name, t)}
          </strong>
        );
      })}
    </>
  );
}
