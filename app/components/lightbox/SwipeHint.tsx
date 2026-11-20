import type { TFunction } from "../../i18n/t";
import { useSwipeHint } from "./useSwipeHint";

/** A short label (the side chevrons are real buttons now); never takes pointer events. */
export function SwipeHint({
  t,
  hasPrev,
  hasNext,
}: {
  t: TFunction;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const { phase, animated } = useSwipeHint(hasPrev || hasNext);
  if (phase === "off") return null;
  const fade = animated
    ? `transition-opacity duration-slow ease-out-soft ${phase === "fading" ? "opacity-0" : "opacity-100"}`
    : "";
  return (
    <div
      data-swipe-hint
      data-state={phase}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${fade}`}
    >
      <p className="absolute inset-x-0 bottom-24 text-center text-body text-white/80">
        {t("lightbox.swipeHint")}
      </p>
    </div>
  );
}
