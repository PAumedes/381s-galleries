export const SUPPORTED_LANGS = ["es", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = "es";

export function asLang(value: string | null | undefined): Lang | null {
  const v = value?.trim().toLowerCase();
  return v === "es" || v === "en" ? v : null;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      return part
        .slice(i + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
    }
  }
  return null;
}

function fromCookie(header: string | null): Lang | null {
  return asLang(cookieValue(header, "lang"));
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

// ------------------------------------------------------------------ admin

export const ADMIN_LANG_COOKIE = "admin_lang";

/** Strict: exactly "es" or "en" (no trimming, no case folding), else null. */
export function asAdminLang(value: string | null | undefined): Lang | null {
  return value === "es" || value === "en" ? value : null;
}

/** `/admin` and below, also for single-fetch `.data` requests. */
export function isAdminPath(pathname: string): boolean {
  const p = pathname.replace(/\.data$/, "");
  return p === "/admin" || p.startsWith("/admin/");
}

/**
 * Admin language: the `admin_lang` cookie only. Anything but "es"/"en" (and a
 * missing cookie) is Spanish; Accept-Language and `?lang=` are ignored.
 */
export function getAdminLang(request: Request): Lang {
  return (
    asAdminLang(
      cookieValue(request.headers.get("cookie"), ADMIN_LANG_COOKIE),
    ) ?? DEFAULT_LANG
  );
}

/** Language of the page being rendered: admin cookie under /admin, else the public rules. */
export function getRequestLang(request: Request): Lang {
  return isAdminPath(new URL(request.url).pathname)
    ? getAdminLang(request)
    : getLang(request);
}

/** Cookie for the admin toggle; scoped to /admin so public pages never see it. */
export function adminLangCookie(lang: Lang, secure = false): string {
  return `${ADMIN_LANG_COOKIE}=${lang}; Max-Age=31536000; Path=/admin; SameSite=Lax${secure ? "; Secure" : ""}`;
}
