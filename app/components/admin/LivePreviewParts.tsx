import { useT } from "../../i18n/use-t";
import type { Palette } from "../../lib/design";
import type { PreviewDevice } from "../../lib/preview-device";
import { Monitor, Phone } from "../icons";
import { paletteKey } from "./DesignPanel";

const toggle =
  "text-micro flex min-h-tap items-center gap-2 border px-3 uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-9";

/** Desktop / phone switch above the preview frame. */
export function DeviceToggle({
  device,
  onDevice,
}: {
  device: PreviewDevice;
  onDevice: (d: PreviewDevice) => void;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("admin.preview.device")}
      className="flex flex-wrap gap-2"
    >
      {(["desktop", "mobile"] as const).map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={device === d}
          onClick={() => onDevice(d)}
          className={`${toggle} ${device === d ? "border-ink bg-ink text-paper" : "border-grey-300 text-grey-700 hover:border-ink hover:text-ink"}`}
        >
          {d === "desktop" ? (
            <Monitor aria-hidden="true" className="size-4" />
          ) : (
            <Phone aria-hidden="true" className="size-4" />
          )}
          {t(d === "desktop" ? "admin.cover.desktop" : "admin.cover.mobile")}
        </button>
      ))}
    </div>
  );
}

/** Palette and mode caption, plus jump buttons when the grid is shown. */
export function PreviewFooter({
  palette,
  proofing,
  showJump,
  onJump,
}: {
  palette: Palette;
  proofing: boolean;
  showJump: boolean;
  onJump: (to: "cover" | "grid") => void;
}) {
  const t = useT();
  return (
    <div className="text-micro text-grey-700 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 uppercase">
      <span>
        {t("admin.cover.palette", { name: t(paletteKey(palette)) })} ·{" "}
        {proofing ? t("admin.cover.proofing") : t("admin.cover.delivery")}
      </span>
      {showJump && (
        <span className="flex gap-4">
          {(["cover", "grid"] as const).map((to) => (
            <button
              key={to}
              type="button"
              onClick={() => onJump(to)}
              className="text-micro text-ink flex min-h-tap items-center uppercase underline-offset-4 hover:underline md:min-h-8"
            >
              {t(
                to === "grid"
                  ? "admin.preview.toGrid"
                  : "admin.preview.toCover",
              )}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
