import { useT } from "../../i18n/use-t";
import type { FitMode, TileSize } from "./photo-fit";

/** Small outlined toolbar button (shared with the per-set sort buttons). */
export const TOOL_BTN =
  "text-micro text-grey-700 hover:text-ink border border-grey-300 hover:border-ink min-h-tap px-3 uppercase disabled:opacity-40 disabled:hover:border-grey-300 disabled:hover:text-grey-700 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:min-h-9";
function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: { value: T; text: string; name?: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <span aria-hidden="true" className="text-micro text-grey-700 uppercase">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.name}
          onClick={() => onPick(o.value)}
          className={`${TOOL_BTN} min-w-tap ${value === o.value ? "bg-ink border-ink text-paper hover:text-paper" : ""}`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** Whole picture or cropped fill, and the tile size: remembered per viewer. */
export function FitControls({
  prefs,
  onChange,
}: {
  prefs: { mode: FitMode; size: TileSize };
  onChange: (next: { mode?: FitMode; size?: TileSize }) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Choice
        label={t("admin.reorder.view")}
        value={prefs.mode}
        onPick={(mode) => onChange({ mode })}
        options={[
          { value: "fit", text: t("admin.reorder.fit") },
          { value: "fill", text: t("admin.reorder.fill") },
        ]}
      />
      <Choice
        label={t("admin.reorder.size")}
        value={prefs.size}
        onPick={(size) => onChange({ size })}
        options={[
          { value: "s", text: "S", name: t("admin.reorder.sizeS") },
          { value: "m", text: "M", name: t("admin.reorder.sizeM") },
          { value: "l", text: "L", name: t("admin.reorder.sizeL") },
        ]}
      />
    </div>
  );
}
