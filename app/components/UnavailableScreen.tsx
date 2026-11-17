import { useT } from "../i18n/use-t";
import { isDarkPalette, type Palette } from "../lib/design";
import { Logo } from "./Logo";

export function UnavailableScreen({
  palette = "claro",
}: {
  palette?: Palette;
}) {
  const t = useT();
  return (
    <main
      data-page=""
      data-theme={palette}
      className="bg-paper text-ink flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center"
    >
      <Logo
        variant={isDarkPalette(palette) ? "light" : "dark"}
        className="h-16"
      />
      <h1 className="text-micro-label text-grey-600 uppercase">
        {t("unavailable.title")}
      </h1>
      <p className="text-body text-grey-600">{t("unavailable.message")}</p>
    </main>
  );
}
