/**
 * Replace lone UTF-16 surrogates with U+FFFD so encodeURIComponent (which
 * throws URIError on them) can never crash a render or a response.
 */
export function wellFormed(s: string): string {
  const native = (s as unknown as { toWellFormed?: () => string }).toWellFormed;
  if (typeof native === "function") return native.call(s);
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

/**
 * A file name stem that is safe in a download header: no path separators or
 * control characters (unicode kept), at most 200 code points, `photo` if
 * nothing is left.
 */
export function safeFileBase(name: string): string {
  return (
    wellFormed(name)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f/\\]/g, "")
      .trim()
      // Truncate by code point so an astral character is never split.
      .match(/[\s\S]/gu)
      ?.slice(0, 200)
      .join("") || "photo"
  );
}
