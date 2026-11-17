import { Fragment } from "react";

/**
 * Renders `<code>…</code>` spans of a (static, developer-written) dictionary
 * string as <code> elements. Everything else stays plain text: no HTML is
 * ever interpreted.
 */
export function withCode(text: string): React.ReactNode {
  return text
    .split(/<code>(.*?)<\/code>/s)
    .map((part, i) =>
      i % 2 === 1 ? (
        <code key={i}>{part}</code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}
