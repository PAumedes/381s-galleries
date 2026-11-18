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
