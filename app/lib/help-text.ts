import type { TFunction } from "../i18n/t";
import { helpItemKeys, type HelpItem } from "./help";

/** A piece of a help text: plain words, a `code` span (folder names), or a {placeholder}. */
export type HelpToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "placeholder"; name: string };

const TOKEN = /`([^`\n]+)`|\{(\w+)\}/g;

export function tokenizeHelp(raw: string): HelpToken[] {
  const out: HelpToken[] = [];
  let last = 0;
  for (const m of raw.matchAll(TOKEN)) {
    if (m.index > last)
      out.push({ kind: "text", text: raw.slice(last, m.index) });
    out.push(
      m[1] !== undefined
        ? { kind: "code", text: m[1] }
        : { kind: "placeholder", name: m[2] },
    );
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push({ kind: "text", text: raw.slice(last) });
  return out;
}

/** The three parts of an item's text, as strings. */
export interface HelpTexts {
  q: string;
  a?: string;
  steps: string[];
}

/** Texts as written in the dictionary (placeholders still in place). */
export function rawHelpItem(item: HelpItem, t: TFunction): HelpTexts {
  const k = helpItemKeys(item);
  return {
    q: t(k.q),
    ...(k.a ? { a: t(k.a) } : {}),
    steps: k.steps.map((key) => t(key)),
  };
}

/** What a placeholder shows: the button name between « », or the fixed value. */
export function placeholderText(
  item: HelpItem,
  name: string,
  t: TFunction,
): string {
  const label = item.labels?.[name];
  if (label) return `«${t(label)}»`;
  const value = item.values?.[name];
  return value === undefined ? `{${name}}` : String(value);
}

function plain(raw: string, item: HelpItem, t: TFunction): string {
  return tokenizeHelp(raw)
    .map((tok) =>
      tok.kind === "placeholder"
        ? placeholderText(item, tok.name, t)
        : tok.text,
    )
    .join("");
}

/** The item as plain text with every label filled in (search, tests, screen readers). */
export function resolveHelpItem(item: HelpItem, t: TFunction): HelpTexts {
  const raw = rawHelpItem(item, t);
  return {
    q: plain(raw.q, item, t),
    ...(raw.a !== undefined ? { a: plain(raw.a, item, t) } : {}),
    steps: raw.steps.map((s) => plain(s, item, t)),
  };
}

/** Lowercase without accents, so "Sincronización" is found by "sincronizacion". */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every word of the query appears somewhere in the question, answer or steps. */
export function helpMatches(texts: HelpTexts, query: string): boolean {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldForSearch([texts.q, texts.a ?? "", ...texts.steps].join(" "));
  return words.every((w) => hay.includes(w));
}
