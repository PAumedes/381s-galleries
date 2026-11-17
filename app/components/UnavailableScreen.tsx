import { useT } from "../i18n/use-t";
import { Logo } from "./Logo";

export function UnavailableScreen() {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <Logo variant="dark" className="h-16" />
      <h1 className="text-micro-label text-grey-600 uppercase">
        {t("unavailable.title")}
      </h1>
      <p className="text-body text-grey-600">{t("unavailable.message")}</p>
    </main>
  );
}
