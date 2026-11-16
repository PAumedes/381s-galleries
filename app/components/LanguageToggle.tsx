import { Link, useLocation } from "react-router";

import { useLang } from "../i18n/use-t";
import { useT } from "../i18n/use-t";
import type { Lang } from "../i18n/lang";

export function LanguageToggle({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  const { pathname, search, hash } = useLocation();

  const hrefFor = (target: Lang) => {
    const params = new URLSearchParams(search);
    params.set("lang", target);
    // Collapse leading slashes so a crafted `//host/...` path can't become
    // a protocol-relative (off-site) link.
    const safePath = pathname.replace(/^\/+/, "/");
    return `${safePath}?${params.toString()}${hash}`;
  };

  const items: { code: Lang; label: string }[] = [
    { code: "es", label: t("footer.langEs") },
    { code: "en", label: t("footer.langEn") },
  ];

  return (
    <nav
      aria-label={t("footer.language")}
      className={`text-micro-label flex items-center gap-2 ${className ?? ""}`}
    >
      {items.map(({ code, label }, i) => (
        <span key={code} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          {code === lang ? (
            <span aria-current="true">{label}</span>
          ) : (
            <Link
              to={hrefFor(code)}
              reloadDocument
              hrefLang={code}
              lang={code}
              className="text-grey-600 hover:text-ink"
            >
              {label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
