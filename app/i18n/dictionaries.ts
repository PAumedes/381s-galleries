import { en } from "./en";
import { es } from "./es";
import { getAdminLang, getRequestLang, isAdminPath, type Lang } from "./lang";
import { makeT, type Messages, type TFunction } from "./t";

const ADMIN_PREFIX = "admin.";

const byLang: Record<Lang, Messages> = { es, en };

/** Every message, admin included. */
export function allMessages(lang: Lang): Messages {
  return byLang[lang];
}

const publicCache: Partial<Record<Lang, Messages>> = {};

/** Messages for the public site: the admin strings stay on the server. */
export function publicMessages(lang: Lang): Messages {
  return (publicCache[lang] ??= Object.fromEntries(
    Object.entries(byLang[lang]).filter(([k]) => !k.startsWith(ADMIN_PREFIX)),
  ) as Messages);
}

/** Language and messages to ship with the page for this request (root loader). */
export function messagesForRequest(request: Request): {
  lang: Lang;
  messages: Messages;
} {
  const lang = getRequestLang(request);
  const admin = isAdminPath(new URL(request.url).pathname);
  return {
    lang,
    messages: admin ? allMessages(lang) : publicMessages(lang),
  };
}

/** Translator for server code answering an admin request (cookie language). */
export function requestT(request: Request): TFunction {
  const lang = getAdminLang(request);
  return makeT(lang, byLang[lang]);
}
