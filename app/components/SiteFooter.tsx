import { useT } from "../i18n/use-t";

export function SiteFooter({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <a
      href="/privacy"
      className={`text-micro-label text-grey-600 uppercase underline-offset-4 hover:underline ${className}`}
    >
      {t("footer.privacy")}
    </a>
  );
}
