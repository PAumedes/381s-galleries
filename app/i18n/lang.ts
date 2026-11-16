export const SUPPORTED_LANGS = ["es", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = "es";

export function asLang(value: string | null | undefined): Lang | null {
  const v = value?.trim().toLowerCase();
  return v === "es" || v === "en" ? v : null;
}

function fromCookie(header: string | null): Lang | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === "lang") {
      return asLang(
        part
          .slice(i + 1)
          .trim()
          .replace(/^"(.*)"$/, "$1"),
      );
    }
  }
  return null;
}

function fromAcceptLanguage(header: string | null): Lang | null {
  if (!header) return null;
  const ranked: { lang: Lang; q: number; order: number }[] = [];
  header.split(",").forEach((item, order) => {
    const [tag = "", ...params] = item.trim().split(";");
    const lang = asLang(tag.trim().split("-")[0]);
    if (!lang) return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0 || q > 1) return;
    ranked.push({ lang, q, order });
  });
  ranked.sort((a, b) => b.q - a.q || a.order - b.order);
  return ranked[0]?.lang ?? null;
}

/** ?lang= -> cookie `lang` -> Accept-Language -> "es". */
export function getLang(request: Request): Lang {
  const url = new URL(request.url);
  return (
    asLang(url.searchParams.get("lang")) ??
    fromCookie(request.headers.get("cookie")) ??
    fromAcceptLanguage(request.headers.get("accept-language")) ??
    DEFAULT_LANG
  );
}

export function langCookie(lang: Lang): string {
  return `lang=${lang}; Max-Age=31536000; Path=/; SameSite=Lax`;
}
