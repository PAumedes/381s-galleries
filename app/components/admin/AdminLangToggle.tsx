import { useRevalidator } from "react-router";

import { adminLangCookie, type Lang } from "../../i18n/lang";
import { useLang, useT } from "../../i18n/use-t";

const OPTIONS: { code: Lang; label: string }[] = [
  { code: "es", label: "ES" },
  { code: "en", label: "EN" },
];

function storeAdminLang(lang: Lang) {
  document.cookie = adminLangCookie(
    lang,
    window.location.protocol === "https:",
  );
}

/**
 * Discreet ES / EN switch for the admin. The choice lives in the `admin_lang`
 * cookie (Path=/admin), which the server reads on every admin request (pages
 * and `.data` loads), so the next render is already in the new language.
 */
export function AdminLangToggle() {
  const lang = useLang();
  const t = useT();
  const revalidator = useRevalidator();

  function pick(next: Lang) {
    if (next === lang) return;
    storeAdminLang(next);
    void revalidator.revalidate();
  }

  return (
    <div
      role="group"
      aria-label={t("admin.lang.label")}
      className="text-micro flex items-center gap-2"
    >
      {OPTIONS.map(({ code, label }, i) => (
        <span key={code} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          <button
            type="button"
            lang={code}
            aria-pressed={code === lang}
            onClick={() => pick(code)}
            className={`focus-visible:outline-ink focus-visible:outline-2 focus-visible:outline-offset-2 ${
              code === lang
                ? "text-ink underline underline-offset-4"
                : "text-grey-600 hover:text-ink"
            }`}
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  );
}
